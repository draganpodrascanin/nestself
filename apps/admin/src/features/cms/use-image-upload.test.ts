/**
 * Tests for useImageUpload hook (T-C1.12).
 *
 * Verifies:
 * - Success path: upload → poll → ready → onReady called
 * - Rejection path: upload → poll → rejected → error displayed
 * - Digest mismatch: upload throws 400 validation with digest_mismatch
 * - media_type_rejected: upload throws 400
 * - media_too_large: upload throws 413
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUploadMedia = vi.fn();
const mockGetMediaAsset = vi.fn();

vi.mock('@nestself/api-client', () => {
  class ApiError extends Error {
    status: number;
    code: string;
    requestId: string | null;
    details: Record<string, unknown> | undefined;
    constructor(args: {
      status: number;
      code: string;
      message: string;
      requestId: string | null;
      details?: Record<string, unknown>;
    }) {
      super(args.message);
      this.name = 'ApiError';
      this.status = args.status;
      this.code = args.code;
      this.requestId = args.requestId;
      this.details = args.details;
    }
  }
  return {
    createCmsApi: () => ({
      uploadMedia: mockUploadMedia,
      getMediaAsset: mockGetMediaAsset,
    }),
    ApiError,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Return the key as-is — defaultValue is only used for truly missing keys,
    // and all error.* keys exist in the CMS namespace.
    t: (key: string) => key,
  }),
}));

vi.mock('../../api', () => ({
  api: {},
}));

import { useImageUpload } from './use-image-upload';
import { ApiError } from '@nestself/api-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockFile(name = 'test.jpg', type = 'image/jpeg') {
  return new File(['test-content'], name, { type });
}

/**
 * Simulate the file picker: create a hidden input, attach a file, fire change.
 */
function simulateFilePick(file: File) {
  // The hook creates an <input> and clicks it. We intercept createElement to
  // attach our file, then manually fire the `onchange`.
  const originalCreateElement = document.createElement.bind(document);
  let capturedInput: HTMLInputElement | null = null;

  vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
    const el = originalCreateElement(tag, options);
    if (tag === 'input') {
      capturedInput = el as HTMLInputElement;
      // Override .click() to fire onchange asynchronously
      (el as HTMLInputElement).click = () => {
        // Set the files via Object.defineProperty (files is read-only)
        const fileList = {
          0: file,
          length: 1,
          item: (i: number) => (i === 0 ? file : null),
          [Symbol.iterator]: function* () {
            yield file;
          },
        };
        Object.defineProperty(el, 'files', { value: fileList, writable: true });
        // Call onchange in a microtask
        queueMicrotask(() => {
          (el as HTMLInputElement).onchange?.(new Event('change'));
        });
      };
    }
    return el;
  });

  return { getCapturedInput: () => capturedInput };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useImageUpload', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockUploadMedia.mockReset();
    mockGetMediaAsset.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts in idle phase', () => {
    const { result } = renderHook(() =>
      useImageUpload({ ownerCategoryId: 'cat_1' }),
    );
    expect(result.current.phase).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.assetId).toBeNull();
  });

  it('success path: upload → processing → ready, calls onReady', async () => {
    const onReady = vi.fn();
    const file = createMockFile();

    mockUploadMedia.mockResolvedValueOnce({ assetId: 'asset_123', state: 'uploaded' });
    mockGetMediaAsset.mockResolvedValueOnce({ state: 'processing' });
    mockGetMediaAsset.mockResolvedValueOnce({ state: 'ready' });

    simulateFilePick(file);

    const { result } = renderHook(() =>
      useImageUpload({ ownerCategoryId: 'cat_1', onReady }),
    );

    // Trigger the picker
    await act(async () => {
      result.current.pickAndUpload();
    });

    // Wait for the upload to start
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    // After upload completes, should be in processing
    await vi.waitFor(() => {
      expect(mockUploadMedia).toHaveBeenCalledTimes(1);
    });

    // Advance through polling
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    // Should eventually call onReady
    await vi.waitFor(() => {
      expect(onReady).toHaveBeenCalledWith('asset_123');
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.assetId).toBe('asset_123');
    expect(result.current.error).toBeNull();
  });

  it('rejection path: upload → poll → rejected → error', async () => {
    const file = createMockFile();

    mockUploadMedia.mockResolvedValueOnce({ assetId: 'asset_bad', state: 'uploaded' });
    mockGetMediaAsset.mockResolvedValueOnce({ state: 'rejected' });

    simulateFilePick(file);

    const { result } = renderHook(() =>
      useImageUpload({ ownerCategoryId: 'cat_1' }),
    );

    await act(async () => {
      result.current.pickAndUpload();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    await vi.waitFor(() => {
      expect(result.current.phase).toBe('error');
    });

    expect(result.current.error).toBe('error.media_type_rejected');
  });

  it('digest mismatch: upload fails with 400 validation + digest_mismatch', async () => {
    const file = createMockFile();

    mockUploadMedia.mockRejectedValueOnce(
      new ApiError({
        code: 'validation',
        message: 'Content-Digest does not match',
        status: 400,
        requestId: null,
        details: { reason: 'digest_mismatch' },
      }),
    );

    simulateFilePick(file);

    const { result } = renderHook(() =>
      useImageUpload({ ownerCategoryId: 'cat_1' }),
    );

    await act(async () => {
      result.current.pickAndUpload();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    await vi.waitFor(() => {
      expect(result.current.phase).toBe('error');
    });

    expect(result.current.error).toBe('error.media_digest_mismatch');
  });

  it('media_type_rejected: upload fails with 400', async () => {
    const file = createMockFile('test.bmp', 'image/bmp');

    mockUploadMedia.mockRejectedValueOnce(
      new ApiError({
        code: 'media_type_rejected',
        message: 'File type not accepted',
        status: 400,
        requestId: null,
      }),
    );

    simulateFilePick(file);

    const { result } = renderHook(() =>
      useImageUpload({ ownerCategoryId: 'cat_1' }),
    );

    await act(async () => {
      result.current.pickAndUpload();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    await vi.waitFor(() => {
      expect(result.current.phase).toBe('error');
    });

    expect(result.current.error).toBe('error.media_type_rejected');
  });

  it('reset clears the error state', async () => {
    const file = createMockFile();

    mockUploadMedia.mockRejectedValueOnce(
      new ApiError({
        code: 'media_too_large',
        message: 'File too large',
        status: 413,
        requestId: null,
      }),
    );

    simulateFilePick(file);

    const { result } = renderHook(() =>
      useImageUpload({ ownerCategoryId: 'cat_1' }),
    );

    await act(async () => {
      result.current.pickAndUpload();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    await vi.waitFor(() => {
      expect(result.current.phase).toBe('error');
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.phase).toBe('idle');
    expect(result.current.error).toBeNull();
  });
});

/**
 * useImageUpload — hook that handles the full image upload lifecycle:
 *
 * 1. Opens a file picker (accept: image/jpeg, image/png, image/webp)
 * 2. Uploads via CMS API with Content-Digest and Idempotency-Key
 * 3. Polls the asset status until `ready` or a terminal state
 * 4. Returns the assetId for insertion into the editor
 *
 * The hook surfaces every state transition so the UI can show
 * processing/error states per the error-states rule.
 */
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createCmsApi, ApiError } from '@nestself/api-client';
import type { MediaUploadMetadata } from '@nestself/contracts';
import { api } from '../../api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadPhase =
  | 'idle'
  | 'picking'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'error';

export interface ImageUploadState {
  phase: UploadPhase;
  assetId: string | null;
  error: string | null;
  /** Progress label for UI display. */
  progressLabel: string;
}

export interface UseImageUploadOptions {
  /** Owner category for the uploaded image (content resource's primary category). */
  ownerCategoryId: string;
  /** Alt text to set on the image (keyed by locale). */
  altText?: Record<string, string>;
  /** Called when the asset is ready with its assetId. */
  onReady?: (assetId: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCEPT = 'image/jpeg,image/png,image/webp';
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 30; // 60 seconds max

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useImageUpload(options: UseImageUploadOptions) {
  const { t } = useTranslation('cms');
  const [state, setState] = useState<ImageUploadState>({
    phase: 'idle',
    assetId: null,
    error: null,
    progressLabel: '',
  });
  const abortRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const cmsApi = createCmsApi(api);

  /**
   * Map API error codes (including digest_mismatch which comes as a
   * `validation` code with `details.reason`) to translated messages.
   */
  const mapError = useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        // Digest mismatch comes as 400 `validation` with details.reason
        if (
          err.code === 'validation' &&
          (err.details as Record<string, unknown>)?.reason === 'digest_mismatch'
        ) {
          return t('error.media_digest_mismatch');
        }
        const code = err.code ?? 'unknown';
        return t(`error.${code}`, { defaultValue: t('error.unknown') });
      }
      return t('error.unknown');
    },
    [t],
  );

  /**
   * Poll the asset status until it reaches a terminal state.
   */
  const pollUntilReady = useCallback(
    async (assetId: string): Promise<'ready' | 'rejected' | 'error'> => {
      for (let i = 0; i < MAX_POLLS; i++) {
        if (abortRef.current) return 'error';

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

        try {
          const asset = await cmsApi.getMediaAsset(assetId);
          if (asset.state === 'ready') return 'ready';
          if (asset.state === 'rejected' || asset.state === 'quarantined') {
            return 'rejected';
          }
          // 'uploaded', 'processing' — keep polling
        } catch {
          // Network error during poll — keep trying
        }
      }
      return 'error'; // timed out
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Trigger the file picker and run the full upload+poll flow.
   */
  const pickAndUpload = useCallback(() => {
    abortRef.current = false;

    // Create a hidden file input
    if (!inputRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = ACCEPT;
      input.style.display = 'none';
      document.body.appendChild(input);
      inputRef.current = input;
    }

    const input = inputRef.current;

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        setState({ phase: 'idle', assetId: null, error: null, progressLabel: '' });
        return;
      }

      // --- Upload phase ---
      setState({
        phase: 'uploading',
        assetId: null,
        error: null,
        progressLabel: t('editor.image.uploading'),
      });

      try {
        const metadata: MediaUploadMetadata = {
          kind: 'image',
          ownerCategoryId: options.ownerCategoryId,
          licenseKind: 'owned',
          ...(options.altText ? { altText: options.altText } : {}),
        };

        const result = await cmsApi.uploadMedia(file, metadata);

        // --- Processing phase ---
        setState({
          phase: 'processing',
          assetId: result.assetId,
          error: null,
          progressLabel: t('editor.image.processing'),
        });

        const outcome = await pollUntilReady(result.assetId);

        if (outcome === 'ready') {
          setState({
            phase: 'ready',
            assetId: result.assetId,
            error: null,
            progressLabel: '',
          });
          options.onReady?.(result.assetId);
        } else if (outcome === 'rejected') {
          setState({
            phase: 'error',
            assetId: result.assetId,
            error: t('error.media_type_rejected'),
            progressLabel: '',
          });
        } else {
          setState({
            phase: 'error',
            assetId: result.assetId,
            error: t('error.media_not_ready'),
            progressLabel: '',
          });
        }
      } catch (err) {
        setState({
          phase: 'error',
          assetId: null,
          error: mapError(err),
          progressLabel: '',
        });
      }

      // Reset the input so the same file can be re-picked
      input.value = '';
    };

    setState({ phase: 'picking', assetId: null, error: null, progressLabel: '' });
    input.click();
  }, [cmsApi, mapError, options, pollUntilReady, t]);

  /**
   * Cancel an in-progress upload/poll.
   */
  const cancel = useCallback(() => {
    abortRef.current = true;
    setState({ phase: 'idle', assetId: null, error: null, progressLabel: '' });
  }, []);

  /**
   * Reset to idle after an error.
   */
  const reset = useCallback(() => {
    abortRef.current = true;
    setState({ phase: 'idle', assetId: null, error: null, progressLabel: '' });
  }, []);

  return { ...state, pickAndUpload, cancel, reset };
}

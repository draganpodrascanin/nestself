/**
 * LibraryController — employee library endpoints (T-C1.11, 9.12).
 *
 * GET  /api/library/content/:contentId   — content detail
 * GET  /api/library/content              — content list
 *
 * All routes use `personalOrgResource('library')` which enforces the
 * personal context with an orgId (C-22).
 */
import {
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import type { Principal } from '@nestself/contracts';
import { ACTIONS, LibraryContentListQuerySchema } from '@nestself/contracts';
import type { LibraryContentListQuery } from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { personalOrgResource } from '../authz/resolvers.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { LibraryService } from './library.service.js';
import { parseAcceptLanguageLocale } from './locale-header.js';
import { resolveLibraryContext } from './principal-context.js';

function contentIdFromReq(req: Record<string, unknown>): string | undefined {
  const params = req['params'] as Record<string, string | undefined> | undefined;
  return params?.['contentId'];
}

@Controller('library')
export class LibraryController {
  constructor(private readonly libraryService: LibraryService) {}

  @Get('content/:contentId')
  @Authorize(ACTIONS['content.read'], personalOrgResource('library', contentIdFromReq))
  async getContentDetail(
    @Param('contentId') contentId: string,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    const locale = parseAcceptLanguageLocale(acceptLanguage);
    const pCtx = resolveLibraryContext(principal);

    const result = await this.libraryService.getContentDetail(pCtx, contentId, locale);

    if (!result) {
      throw new ApiHttpException({
        status: HttpStatus.NOT_FOUND,
        code: 'content_not_available',
        message: 'The requested content is not available',
      });
    }

    return result;
  }

  @Get('content')
  @Authorize(ACTIONS['content.read'], personalOrgResource('library'))
  async listContent(
    @Query(new ZodValidationPipe(LibraryContentListQuerySchema)) query: LibraryContentListQuery,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    const locale = parseAcceptLanguageLocale(acceptLanguage);
    const pCtx = resolveLibraryContext(principal);

    return this.libraryService.listContent(pCtx, locale, {
      categoryId: query.categoryId,
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}

/**
 * SavedController -- saved items endpoints for /api/me/* (T-C1.11, 9.7).
 *
 * GET    /api/me/saved             -- list saved items
 * PUT    /api/me/saved/:contentId  -- save (idempotent)
 * DELETE /api/me/saved/:contentId  -- remove (no availability check: LIB-R-26)
 *
 * All routes use `personalOrgResource('saved_item')` and `content.bookmark`.
 */
import {
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import type { Principal } from '@nestself/contracts';
import { ACTIONS, SavedItemsListQuerySchema } from '@nestself/contracts';
import type { SavedItemsListQuery } from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { personalOrgResource } from '../authz/resolvers.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { LibraryService } from './library.service.js';
import { parseAcceptLanguageLocale } from './locale-header.js';
import { resolveLibraryContext } from './principal-context.js';

function savedIdFromReq(req: Record<string, unknown>): string | undefined {
  const params = req['params'] as Record<string, string | undefined> | undefined;
  return params?.['contentId'];
}

@Controller('me')
export class SavedController {
  constructor(private readonly libraryService: LibraryService) {}

  @Get('saved')
  @Authorize(ACTIONS['content.bookmark'], personalOrgResource('saved_item'))
  @Header('Vary', 'Accept-Language')
  @Header('Cache-Control', 'private, no-store')
  async listSaved(
    @Query(new ZodValidationPipe(SavedItemsListQuerySchema)) query: SavedItemsListQuery,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    const locale = parseAcceptLanguageLocale(acceptLanguage);
    const pCtx = resolveLibraryContext(principal);

    return this.libraryService.getSavedItems(pCtx, locale, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Put('saved/:contentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authorize(ACTIONS['content.bookmark'], personalOrgResource('saved_item', savedIdFromReq))
  async saveItem(
    @Param('contentId') contentId: string,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    const locale = parseAcceptLanguageLocale(acceptLanguage);
    const pCtx = resolveLibraryContext(principal);

    // Service throws ApiHttpException (content_not_available) if unavailable
    await this.libraryService.saveItem(pCtx, contentId, locale);
  }

  @Delete('saved/:contentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authorize(ACTIONS['content.bookmark'], personalOrgResource('saved_item', savedIdFromReq))
  async removeSaved(
    @Param('contentId') contentId: string,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    const locale = parseAcceptLanguageLocale(acceptLanguage);
    const pCtx = resolveLibraryContext(principal);

    // No availability check: users remove unavailable placeholders (LIB-R-26)
    await this.libraryService.removeSavedItem(pCtx, contentId, locale);
  }
}

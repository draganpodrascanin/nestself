/**
 * SavedController — saved items endpoints for /api/me/* (T-C1.11, 9.7).
 *
 * GET    /api/me/saved             — list saved items
 * PUT    /api/me/saved/:contentId  — save (idempotent)
 * DELETE /api/me/saved/:contentId  — remove
 *
 * All routes use `personalOrgResource('saved_item')` and `content.bookmark`.
 */
import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import type { Principal } from '@nestself/contracts';
import { ACTIONS } from '@nestself/contracts';
import { Authorize } from '../authz/authorize.decorator.js';
import { personalOrgResource } from '../authz/resolvers.js';
import { CurrentPrincipal } from '../auth/current-principal.decorator.js';
import { ApiHttpException } from '../common/api-error.js';
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
  async listSaved(
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limitStr: string | undefined,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @CurrentPrincipal() principal: Principal,
  ) {
    const locale = parseAcceptLanguageLocale(acceptLanguage);
    const pCtx = resolveLibraryContext(principal);

    const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 20, 1), 50) : 20;

    return this.libraryService.getSavedItems(pCtx, locale, { cursor, limit });
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

    try {
      await this.libraryService.saveItem(pCtx, contentId, locale);
    } catch (e) {
      if (e === null) {
        throw new ApiHttpException({
          status: HttpStatus.NOT_FOUND,
          code: 'content_not_available',
          message: 'The requested content is not available',
        });
      }
      throw e;
    }
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

    await this.libraryService.removeSavedItem(pCtx, contentId, locale);
  }
}

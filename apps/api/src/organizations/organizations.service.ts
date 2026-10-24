/**
 * OrganizationsService: read-only client list for the operations workspace
 * (auth UI completeness plan, 2026-10-25). Creating and changing clients is
 * a product task and stays out of this service.
 */
import { Injectable } from '@nestjs/common';
import type {
  OrganizationListQuery,
  OrganizationListResponse,
  OrganizationResponse,
  OrganizationStatus,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import {
  OrganizationsRepository,
  type OrganizationRow,
} from '../db/repositories/organizations.repository.js';
import { ApiHttpException } from '../common/api-error.js';

export function toOrganizationResponse(row: OrganizationRow): OrganizationResponse {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status as OrganizationStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class OrganizationsService {
  constructor(private readonly repo: OrganizationsRepository) {}

  async list(query: OrganizationListQuery): Promise<OrganizationListResponse> {
    const rows = await this.repo.list({ limit: query.limit, cursor: query.cursor, search: query.search });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: items.map(toOrganizationResponse),
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }

  async get(orgId: string): Promise<OrganizationResponse> {
    const row = await this.repo.findById(orgId);
    if (!row) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Organization not found' });
    }
    return toOrganizationResponse(row);
  }
}

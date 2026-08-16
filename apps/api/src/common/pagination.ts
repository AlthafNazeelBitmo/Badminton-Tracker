import type { PageMeta, Paginated, PaginationQuery } from '@badminton/contracts';

export function paginate(query: PaginationQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function pageMeta(query: PaginationQuery, totalItems: number): PageMeta {
  const totalPages = Math.max(1, Math.ceil(totalItems / query.pageSize));
  return {
    page: query.page,
    pageSize: query.pageSize,
    totalItems,
    totalPages,
    hasNextPage: query.page < totalPages,
    hasPreviousPage: query.page > 1,
  };
}

export function emptyPage<T>(query: PaginationQuery): Paginated<T> {
  return { items: [], meta: pageMeta(query, 0) };
}

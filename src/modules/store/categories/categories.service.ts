import { NotFoundError } from "../../../shared/errors.js";
import { paginationOffset } from "../../../shared/pagination.js";
import {
  findActiveCategoryBySlug,
  listActiveCategories,
  type CategoryRow,
} from "./categories.repository.js";

export type StoreCategoryDto = {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
};

function toDto(row: CategoryRow): StoreCategoryDto {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    slug: row.slug,
  };
}

export async function listStoreCategoriesService(input: { page: number; pageSize: number }) {
  const { rows, total } = await listActiveCategories({
    limit: input.pageSize,
    offset: paginationOffset(input.page, input.pageSize),
  });
  return { items: rows.map(toDto), total };
}

export async function getStoreCategoryBySlugService(slug: string) {
  const category = await findActiveCategoryBySlug(slug);
  if (!category) {
    throw new NotFoundError("Category not found");
  }
  return toDto(category);
}

import { NotFoundError } from "../../../shared/errors.js";
import { paginationOffset } from "../../../shared/pagination.js";
import {
  findActiveProductBySlug,
  listActiveProducts,
  listAvailabilityByProductId,
  listImagesByProductId,
  listVariantsByProductId,
  type AvailabilityRow,
  type ImageRow,
  type ProductListRow,
  type ProductRow,
  type VariantRow,
} from "./products.repository.js";

/** Cap exact warehouse counts for public display. */
const PUBLIC_AVAILABLE_CAP = 20;
const LOW_STOCK_THRESHOLD = 5;

export type StoreProductListItem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: { id: string; name: string; slug: string } | null;
  fromPrice: string | null;
  currency: string;
  primaryImageUrl: string | null;
  variantsCount: number;
};

export type StoreProductDetail = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: { id: string; name: string; slug: string } | null;
  currency: string;
  variants: Array<{
    id: string;
    sku: string;
    price: string;
    compareAtPrice: string | null;
    attributes: Record<string, unknown>;
    inStock: boolean;
    lowStock: boolean;
  }>;
  images: Array<{
    id: string;
    url: string;
    sortOrder: number;
    variantId: string | null;
  }>;
  inStock: boolean;
  lowStock: boolean;
};

export type StoreAvailability = {
  variants: Array<{
    variantId: string;
    sku: string;
    available: number;
    sellable: boolean;
  }>;
};

function formatMoney(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num.toFixed(2);
}

function publicAvailable(raw: number): number {
  return Math.min(Math.max(raw, 0), PUBLIC_AVAILABLE_CAP);
}

function mapListItem(row: ProductListRow): StoreProductListItem {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    category:
      row.category_id && row.category_name && row.category_slug
        ? { id: row.category_id, name: row.category_name, slug: row.category_slug }
        : null,
    fromPrice: formatMoney(row.from_price),
    currency: row.currency ?? "INR",
    primaryImageUrl: row.primary_image_url,
    variantsCount: row.variants_count,
  };
}

function mapDetail(
  product: ProductRow,
  variants: VariantRow[],
  images: ImageRow[],
  availability: AvailabilityRow[],
): StoreProductDetail {
  const availabilityByVariant = new Map(
    availability.map((row) => [row.variant_id, row.available]),
  );

  const mappedVariants = variants.map((variant) => {
    const available = availabilityByVariant.get(variant.id) ?? 0;
    return {
      id: variant.id,
      sku: variant.sku,
      price: formatMoney(variant.price) ?? "0.00",
      compareAtPrice: formatMoney(variant.compare_at_price),
      attributes: variant.attributes ?? {},
      inStock: available > 0,
      lowStock: available > 0 && available <= LOW_STOCK_THRESHOLD,
    };
  });

  const inStock = mappedVariants.some((variant) => variant.inStock);
  const lowStock = inStock && mappedVariants.every((variant) => !variant.inStock || variant.lowStock);

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    category:
      product.category_id && product.category_name && product.category_slug
        ? {
            id: product.category_id,
            name: product.category_name,
            slug: product.category_slug,
          }
        : null,
    currency: variants[0]?.currency ?? "INR",
    variants: mappedVariants,
    images: images.map((image) => ({
      id: image.id,
      url: image.storage_key,
      sortOrder: image.sort_order,
      variantId: image.variant_id,
    })),
    inStock,
    lowStock,
  };
}

export async function listStoreProductsService(input: {
  page: number;
  pageSize: number;
  search: string;
  categorySlug?: string;
  sort: "newest" | "price_asc" | "price_desc";
}) {
  const { rows, total } = await listActiveProducts({
    search: input.search,
    categorySlug: input.categorySlug,
    sort: input.sort,
    limit: input.pageSize,
    offset: paginationOffset(input.page, input.pageSize),
  });
  return { items: rows.map(mapListItem), total };
}

export async function getStoreProductBySlugService(slug: string) {
  const product = await findActiveProductBySlug(slug);
  if (!product) {
    throw new NotFoundError("Product not found");
  }

  const [variants, images, availability] = await Promise.all([
    listVariantsByProductId(product.id),
    listImagesByProductId(product.id),
    listAvailabilityByProductId(product.id),
  ]);

  return mapDetail(product, variants, images, availability);
}

export async function getStoreProductAvailabilityService(slug: string) {
  const product = await findActiveProductBySlug(slug);
  if (!product) {
    throw new NotFoundError("Product not found");
  }

  const availability = await listAvailabilityByProductId(product.id);
  const payload: StoreAvailability = {
    variants: availability.map((row) => {
      const available = publicAvailable(row.available);
      return {
        variantId: row.variant_id,
        sku: row.sku,
        available,
        sellable: available > 0,
      };
    }),
  };
  return payload;
}

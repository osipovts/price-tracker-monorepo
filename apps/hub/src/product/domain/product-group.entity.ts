export interface ProductGroupInterface {
  id: string;
  userId: string;
  /** What the user called the group; null while they have not, and the group is called after its first product. */
  title: string | null;
  createdAt: Date;
}

/** The same item tracked on several marketplaces, the products of which are compared. */
export class ProductGroupEntity {
  constructor(readonly snapshot: ProductGroupInterface) {}
}

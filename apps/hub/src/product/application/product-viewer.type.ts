/** An administrator, who sees the groups and the products of every user and changes none of them. */
export const administratorViewer = Symbol('administratorViewer');

/** Who looks at a group or a product: the user who owns it, by their id, or an administrator. */
export type ProductViewerType = string | typeof administratorViewer;

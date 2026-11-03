import { z } from 'zod';

/** An amount in rubles: the site gives it as a string of digits, and zero where there is none. */
const rublesSchema = z.union([z.string(), z.number()]);
const productSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().min(1),
  isAvailable: z.boolean(),
  price: z.object({ current: rublesSchema, club: rublesSchema.nullish() }),
  images: z
    .array(z.object({ sources: z.array(z.object({ url: z.string(), size: z.string() })) }))
    .optional(),
});
const stateSchema = z.object({
  props: z.object({
    initialState: z.object({
      system: z.object({ metadata: z.record(z.string(), z.unknown()) }).optional(),
      productPage: z
        .object({
          productHeader: z.object({
            payload: z.object({ productBase: z.unknown() }).nullish(),
          }),
        })
        .optional(),
    }),
  }),
});

export interface CitilinkStateInterface {
  /** The city the server rendered the page for; null when it names none. */
  cityId: string | null;
  /** The product of the card; null when the page is not a card or its product is not of the expected shape. */
  product: z.infer<typeof productSchema> | null;
}

/** Reads the state a Citilink page was rendered from: the city of the visitor and the product of the card. */
export class CitilinkStateParser {
  /** Returns null when the text is not the state of a page. */
  parse(text: string): CitilinkStateInterface | null {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }

    const state = stateSchema.safeParse(value);
    if (!state.success) return null;

    const { system, productPage } = state.data.props.initialState;
    const cityId = system?.metadata['x-citilink-city-id'];
    const product = productSchema.safeParse(productPage?.productHeader.payload?.productBase);

    return {
      cityId: typeof cityId === 'string' && cityId !== '' ? cityId : null,
      product: product.success ? product.data : null,
    };
  }
}

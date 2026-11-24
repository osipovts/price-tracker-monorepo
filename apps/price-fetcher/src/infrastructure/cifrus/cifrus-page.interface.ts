export interface CifrusPageInterface {
  url: string;
  cityId: string | null;
  heading: string;
  offerPrice: string;
  offerCurrency: string;
  offerAvailability: string;
  displayedPriceText: string;
  hasOutOfStockBadge: boolean;
  hasBuyButton: boolean;
  imageUrl: string;
  hasChallenge: boolean;
}

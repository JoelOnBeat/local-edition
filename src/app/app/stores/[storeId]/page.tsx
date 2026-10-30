import { StoreEditionView } from "@/components/edition/store-edition-view";

export default async function StoreEditionPage({ params }: PageProps<"/app/stores/[storeId]">) {
  const { storeId } = await params;
  return <StoreEditionView storeId={storeId} />;
}

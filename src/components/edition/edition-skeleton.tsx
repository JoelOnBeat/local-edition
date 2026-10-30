import { CardBand, Skeleton } from "../ui";
import { Band, Gap, Page } from "../app-ui/frame";
import { Skel } from "../app-ui/states";

/** Loading shape of the edition page: header frame, four item cards, the rail. */
export function EditionSkeleton() {
  return (
    <Page>
    <div role="status" aria-label="Loading the edition" className="contents">
      <Band pad="frame" top={false}>
        <div className="ring-after relative rounded-xl bg-white px-5 pb-9 pt-5 md:px-8">
          <Skeleton className="h-3 w-40 rounded-full" />
          <Skeleton className="mt-8 h-8 w-64 rounded-full" />
          <Skeleton className="mt-5 h-9 w-full max-w-md" />
          <Skeleton className="mt-4 h-3 w-full max-w-sm rounded-full" />
        </div>
      </Band>
      <Gap />
      <Band grow>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="grid content-start gap-3">
            {["This week's special", "On the speakers"].map((t) => (
              <CardBand key={t} title={t} bodyClassName="p-6">
                <Skel className="h-4 w-1/2" />
                <div className="mt-4 grid gap-2.5"><Skel className="h-2.5 w-full rounded-full" /><Skel className="h-2.5 w-11/12 rounded-full" /><Skel className="h-2.5 w-2/3 rounded-full" /></div>
                <div className="mt-5 flex gap-1.5"><Skel className="h-7 w-24 rounded-full" /><Skel className="h-7 w-20 rounded-full" /><Skel className="h-7 w-28 rounded-full" /></div>
              </CardBand>
            ))}
          </div>
          <div className="grid content-start gap-3">
            <CardBand title="Reviewer's note"><div className="grid gap-2.5"><Skel className="h-2.5 w-full rounded-full" /><Skel className="h-2.5 w-3/4 rounded-full" /></div></CardBand>
            <CardBand title="Block profile" flush>
              <div className="grid gap-4 p-4">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="flex items-center gap-3"><Skel className="h-2.5 w-4" /><Skel className="h-2.5 flex-1" /><Skel className="h-2.5 w-10" /></div>)}</div>
            </CardBand>
          </div>
        </div>
      </Band>
    </div>
    </Page>
  );
}

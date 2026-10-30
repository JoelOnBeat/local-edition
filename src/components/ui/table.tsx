import type { ComponentProps } from "react";
import { cx } from "./cx";

/** Editorial table: hairline rows, small-caps headers, horizontal scroll inside its own box on narrow screens. */
export function Table({ className, ...rest }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cx("w-full border-collapse text-left text-sm", className)} {...rest} />
    </div>
  );
}

export function THead({ className, ...rest }: ComponentProps<"thead">) {
  return <thead className={cx("border-b border-ink", className)} {...rest} />;
}

export function TH({ className, ...rest }: ComponentProps<"th">) {
  return <th className={cx("px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted first:pl-0 last:pr-0", className)} {...rest} />;
}

export function TR({ className, interactive, ...rest }: ComponentProps<"tr"> & { interactive?: boolean }) {
  return <tr className={cx("border-b border-rule", interactive && "cursor-pointer transition-colors hover:bg-paper-2", className)} {...rest} />;
}

export function TD({ className, ...rest }: ComponentProps<"td">) {
  return <td className={cx("px-3 py-3 align-middle first:pl-0 last:pr-0", className)} {...rest} />;
}

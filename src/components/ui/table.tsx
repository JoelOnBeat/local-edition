import type { ComponentProps } from "react";
import { cx } from "./cx";

/**
 * Data table on the white plate: 14/500 headers on stone-50, 57px rows split by stone-100 hairlines, row hover tint.
 * Put it inside a CardBand with `flush`, or alone (it brings its own plate). Columns drop by breakpoint, never scroll.
 */
export function Table({ className, ...rest }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto no-scrollbar">
      <table className={cx("w-full border-collapse text-left text-[14px] leading-5", className)} {...rest} />
    </div>
  );
}

export function THead({ className, ...rest }: ComponentProps<"thead">) {
  return <thead className={cx("bg-paper-2", className)} {...rest} />;
}

export function TH({ className, ...rest }: ComponentProps<"th">) {
  return <th className={cx("px-4 py-3.5 text-[14px] font-medium text-ink-strong whitespace-nowrap", className)} {...rest} />;
}

export function TR({ className, interactive, ...rest }: ComponentProps<"tr"> & { interactive?: boolean }) {
  return (
    <tr
      className={cx(
        "group/row border-b border-rule-row bg-white last:border-0",
        interactive && "cursor-pointer transition-colors duration-150 hover:bg-row-hover",
        className,
      )}
      {...rest}
    />
  );
}

export function TD({ className, ...rest }: ComponentProps<"td">) {
  return <td className={cx("px-4 py-4 align-middle font-medium text-ink-strong", className)} {...rest} />;
}

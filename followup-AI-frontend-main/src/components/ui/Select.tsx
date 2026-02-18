"use client";

import {
  type SelectHTMLAttributes,
  forwardRef,
  useId,
} from "react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  placeholder?: string;
  error?: boolean;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    { className = "", options, placeholder, error, ...props },
    ref
  ) => {
    const id = useId();
    return (
      <select
        ref={ref}
        id={id}
        className={`flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${error ? "border-destructive" : ""} ${className}`}
        {...props}
      >
        {placeholder != null && (
          <option value="">{placeholder}</option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }
);

Select.displayName = "Select";

export { Select };

import { type TextareaHTMLAttributes, forwardRef } from "react";

export interface TextareaProps
    extends TextareaHTMLAttributes<HTMLTextAreaElement> { }

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className = "", ...props }, ref) => (
        <textarea
            ref={ref}
            className={`flex min-h-[80px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none ${className}`}
            {...props}
        />
    )
);

Textarea.displayName = "Textarea";

export { Textarea };

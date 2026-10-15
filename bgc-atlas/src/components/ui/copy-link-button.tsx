"use client";

import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCopyUrl } from "@/lib/hooks/use-copy-url";

interface CopyLinkButtonProps {
  label?: string;
  toastTitle?: string;
  variant?: "outline" | "ghost";
  size?: "sm" | "default";
  className?: string;
  /** For pages whose address bar lags their state (Property Search); defaults to the current location. */
  getHref?: () => string;
}

export function CopyLinkButton({
  label = "Copy link to this view",
  toastTitle = "Link copied",
  variant = "outline",
  size = "sm",
  className,
  getHref,
}: CopyLinkButtonProps) {
  const copyUrl = useCopyUrl();
  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => copyUrl(toastTitle, getHref?.())}
      aria-label={label}
      title={label}
      className={className}
    >
      <Link2 className="size-3.5" />
      <span className="hidden sm:inline">Copy link</span>
    </Button>
  );
}

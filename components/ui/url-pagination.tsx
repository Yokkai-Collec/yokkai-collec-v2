"use client";

import { useRouter } from "next/navigation";
import { Pagination } from "@/components/ui/pagination";

export function UrlPagination({
  page,
  pageCount,
  parameter = "page",
  scrollTargetId
}: {
  page: number;
  pageCount: number;
  parameter?: string;
  scrollTargetId: string;
}) {
  const router = useRouter();
  return (
    <Pagination
      page={page}
      pageCount={pageCount}
      scrollTargetId={scrollTargetId}
      onPageChange={target => {
        const url = new URL(window.location.href);
        url.searchParams.set(parameter, String(target));
        router.push(`${url.pathname}${url.search}${url.hash}`, {
          scroll: false
        });
      }}
    />
  );
}

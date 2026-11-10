/* eslint-disable @next/next/no-img-element -- Decorative catalogue thumbnail. */
import {
  collectionCoverImageStyle,
  type CollectionCoverFrame
} from "@/lib/ui/collection-cover-frame";

export function BinderCover({
  image,
  frame,
  license
}: {
  image?: string;
  frame?: CollectionCoverFrame | null;
  license: string;
}) {
  return (
    <span className="yk-binder-cover" aria-hidden="true">
      {image ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          style={collectionCoverImageStyle(frame)}
        />
      ) : (
        <span className="yk-binder-cover-letter">{Array.from(license)[0]}</span>
      )}
    </span>
  );
}

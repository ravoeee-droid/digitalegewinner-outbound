"use client";

import { useState } from "react";
import styles from "./page.module.css";

export default function VideoBubble({ youtubeId }: { youtubeId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`${styles.bubble} ${open ? styles.bubbleOpen : ""}`}>
      {open ? (
        <>
          <iframe
            className={styles.frame}
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
            title="Persönliches Video von Raphael Hermann"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
          <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Video schließen">×</button>
        </>
      ) : (
        <button type="button" className={styles.play} onClick={() => setOpen(true)} aria-label="Video abspielen">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`} alt="" className={styles.thumb} />
          <span className={styles.ring} aria-hidden="true" />
          <span className={styles.icon} aria-hidden="true">▶</span>
          <span className={styles.label}>Video abspielen</span>
        </button>
      )}
    </div>
  );
}

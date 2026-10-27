"use client";

import { useRef, useState } from "react";

const clips = {
  pflege: {
    title: "Pflege-Recruiting",
    url: "https://res.cloudinary.com/buttercreatives/video/upload/v1793092295/production/default/viydh7foakt70zqs71jv.mp4",
    filename: "Aufnahme 07:42",
    duration: "1:34",
  },
  pv: {
    title: "PV-Trust",
    url: "https://res.cloudinary.com/buttercreatives/video/upload/v1793092348/production/default/qkypvyvo5n8upyiifbei.mp4",
    filename: "Aufnahme 07:43",
    duration: "1:41",
  },
} as const;

type Segment = keyof typeof clips;

function PreviewPlayer({ segment }: { segment: Segment }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const entry = clips[segment];
  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  };
  const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return (
    <div className="fake-loom">
      <div className="site-shot" aria-label="Demo-Website im Hintergrund" />
      <div className="camera-circle">
        <video
          ref={videoRef}
          src={entry.url}
          preload="metadata"
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
          onTimeUpdate={e => setSeconds(e.currentTarget.currentTime)}
        />
      </div>
      {!playing && <button type="button" className="start-button" onClick={toggle} aria-label="Video abspielen"><span>▶</span>Video abspielen</button>}
      {playing && <button type="button" className="pause-layer" onClick={toggle} aria-label="Video pausieren" />}
      <div className="bottom-bar">
        <button onClick={toggle} type="button" aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
        <span>{time(seconds)} / {duration ? time(duration) : entry.duration}</span>
        <input aria-label="Videoposition" type="range" min={0} max={duration || 1} value={Math.min(seconds, duration || 1)} step={0.1} onChange={event => { if(videoRef.current) videoRef.current.currentTime=Number(event.target.value) }} />
      </div>
    </div>
  );
}

export default function VideoPreviewPage() {
  const [segment, setSegment] = useState<Segment>("pflege");
  return (
    <main className="preview-page">
      <div className="wrapper">
        <div className="eyebrow">DG Outbound · interne Video-Vorschau</div>
        <h1>Unsere beiden Talking-Head-Videos</h1>
        <p>So wird deine Aufnahme in der runden Kamera-Bubble angezeigt. Die Website im Hintergrund ist nur ein Demo-Screenshot. Bei einem echten Lead wird sie automatisch gegen dessen Website ausgetauscht.</p>
        <div className="tabs">
          {(["pflege", "pv"] as const).map((key) => <button key={key} className={key === segment ? "selected" : ""} onClick={() => setSegment(key)} type="button">{clips[key].title}</button>)}
        </div>
        <div className="layout">
          <div className="video-col">
            <PreviewPlayer key={segment} segment={segment} />
            <p className="meta">{clips[segment].filename} · {clips[segment].duration} · Ton optimiert</p>
            <div className="detail"><h2>Vorschau – noch kein Live-Versand</h2><p>Diese Seite dient nur zur Kontrolle von Bild, Ton und Position der Bubble. Die automatisierten Kampagnen wurden dadurch nicht verändert.</p></div>
          </div>
          <div className="booking"><h2>Termin direkt buchen</h2><p>Hier sehen Interessenten später die reguläre Buchungsfunktion der individuellen Videoseite.</p><div className="calendar-placeholder">Kalender und freie Termine des jeweiligen Funnels</div></div>
        </div>
      </div>
      <style>{`
        * { box-sizing:border-box; }
        .preview-page {min-height:100vh;background:#f7f5f2;color:#24211d;font-family:Arial,Helvetica,sans-serif;padding:36px 18px 72px}
        .wrapper{max-width:1220px;margin:0 auto}.eyebrow{color:#d46a19;font-weight:700;font-size:12px;letter-spacing:.12em;text-transform:uppercase}
        h1{font-size:clamp(26px,3vw,42px);margin:10px 0}p{line-height:1.55;color:#5e564f}
        .tabs{display:flex;gap:10px;margin:26px 0 18px}.tabs button{padding:12px 18px;background:#fff;border:1px solid #dcd6cf;border-radius:9px;font-weight:700;cursor:pointer;color:#24211d}
        .tabs button.selected{background:#211f1d;border-color:#211f1d;color:#fff}
        .layout{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(290px,.8fr);gap:24px}
        .fake-loom{position:relative;width:100%;aspect-ratio:16/9;background:#161412;border-radius:14px;overflow:hidden;box-shadow:0 12px 32px #241a1022}
        .site-shot{position:absolute;inset:0;background:#ddd url('/v-demo.jpg') center top/cover no-repeat}
        .camera-circle{position:absolute;left:3.2%;bottom:13%;width:19%;aspect-ratio:1;border-radius:50%;border:4px solid #fff;background:#161412;box-shadow:0 7px 28px #0008;overflow:hidden}
        .camera-circle video{position:absolute;left:50%;top:50%;width:330%;height:auto;transform:translate(-50%,-46%);pointer-events:none}
        .start-button{position:absolute;inset:0;border:0;background:#0004;color:#fff;font-size:16px;font-weight:700;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:13px;cursor:pointer}
        .start-button span{background:white;color:#181818;width:67px;height:67px;border-radius:50%;display:grid;place-content:center;padding-left:4px;font-size:26px}
        .pause-layer{position:absolute;inset:0 0 45px;border:0;background:transparent;cursor:pointer}
        .bottom-bar{position:absolute;bottom:0;left:0;right:0;display:flex;align-items:center;gap:12px;height:45px;padding:0 14px;background:linear-gradient(transparent,#000b);color:#fff}
        .bottom-bar button{border:0;background:transparent;color:#fff;font-size:17px;cursor:pointer}.bottom-bar span{white-space:nowrap;font-size:12px;font-variant-numeric:tabular-nums}
        .bottom-bar input{width:100%;accent-color:#ff8b36;cursor:pointer}
        .meta{font-size:13px}.detail,.booking{padding:22px;background:#fff;border:1px solid #e2ddd5;border-radius:14px}.detail{margin-top:20px}.detail h2,.booking h2{font-size:19px;margin:0 0 10px}
        .calendar-placeholder{margin-top:24px;padding:32px 15px;min-height:190px;background:#f7f5f2;border:1px dashed #cabcae;border-radius:11px;display:grid;place-items:center;text-align:center;color:#72675e;font-size:14px}
        @media(max-width:790px){.layout{grid-template-columns:1fr}.booking{min-height:200px}.tabs button{flex:1}.preview-page{padding-top:24px}.camera-circle{border-width:2px}}
      `}</style>
    </main>
  );
}

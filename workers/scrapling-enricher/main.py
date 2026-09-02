import asyncio
import os
import re
from typing import Any
from urllib.parse import urljoin, urlparse

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from scrapling.fetchers import Fetcher

app = FastAPI(title="Digitale Gewinner Scrapling Enricher", version="1.0.0")
Fetcher.adaptive = True

EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
PHONE_RE = re.compile(r"(?:\+49|0)[\d\s()\-/]{7,}")
OFFICE_HIRING_RE = re.compile(r"(?:büro|buero|sekretariat|empfang|disposition|kaufmänn|kaufmaenn|innendienst).{0,80}(?:gesucht|stellenangebot|karriere|job|verstärkung|verstaerkung)", re.I | re.S)
DECISION_RE = re.compile(r"(?:geschäftsführer|geschaeftsfuehrer|inhaber(?:in)?|geschäftsleitung|geschaeftsleitung)\s*[:\-]?\s*([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+){1,2})")


class Target(BaseModel):
    companyId: str = Field(min_length=3)
    company: str = ""
    url: str = Field(min_length=8)


class EnrichRequest(BaseModel):
    targets: list[Target] = Field(min_length=1, max_length=25)


def _authorized(authorization: str | None) -> bool:
    secret = os.getenv("SCRAPLING_WORKER_SECRET", "")
    if not secret:
        return True
    return authorization == f"Bearer {secret}"


def _normalize_url(raw: str) -> str:
    value = raw.strip()
    if not value.startswith(("http://", "https://")):
        value = f"https://{value}"
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Ungültige Website-URL")
    return value


def _same_host(base: str, candidate: str) -> bool:
    try:
        return urlparse(base).hostname == urlparse(candidate).hostname
    except Exception:
        return False


def _page_to_text(page: Any) -> tuple[str, str]:
    markdown = page.markdown(main_content_only=True) or ""
    try:
        encoding = getattr(page, "encoding", None) or "utf-8"
        html = page.body.decode(encoding, errors="ignore") if isinstance(page.body, (bytes, bytearray)) else str(page.body or "")
    except Exception:
        html = ""
    return markdown[:120_000], html[:250_000]


def _candidate_links(page: Any, base_url: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for anchor in page.css("a")[:300]:
        href = str(anchor.attrib.get("href", "") or "").strip()
        if not href or href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        url = urljoin(base_url, href)
        if not _same_host(base_url, url):
            continue
        text = " ".join((anchor.get_all_text(strip=True) or "").split()).lower()
        haystack = f"{text} {href.lower()}"
        for key, words in {
            "contact": ("kontakt", "contact"),
            "imprint": ("impressum", "imprint"),
            "careers": ("karriere", "jobs", "stellen", "career"),
            "team": ("team", "über-uns", "ueber-uns", "about"),
        }.items():
            if key not in found and any(word in haystack for word in words):
                found[key] = url
    return found


def _fetch(url: str) -> Any:
    return Fetcher.get(url, timeout=15, stealthy_headers=True)


def _extract_one(target: Target) -> dict[str, Any]:
    base = _normalize_url(target.url)
    page = _fetch(base)
    text, html = _page_to_text(page)
    links = _candidate_links(page, base)
    pages: list[tuple[str, str, str]] = [(base, text, html)]

    for key in ("contact", "imprint", "careers", "team"):
        url = links.get(key)
        if not url:
            continue
        try:
            child = _fetch(url)
            child_text, child_html = _page_to_text(child)
            pages.append((url, child_text, child_html))
        except Exception:
            continue

    combined_text = "\n".join(item[1] for item in pages)
    combined_html = "\n".join(item[2] for item in pages)
    lower = f"{combined_text}\n{combined_html}".lower()

    emails = sorted(set(EMAIL_RE.findall(combined_text)))[:12]
    phones = sorted({" ".join(item.split()) for item in PHONE_RE.findall(combined_text)})[:12]
    decision_makers = sorted(set(match.group(1).strip() for match in DECISION_RE.finditer(combined_text)))[:8]

    whatsapp = "wa.me/" in lower or "api.whatsapp.com" in lower or "whatsapp" in lower
    booking = any(token in lower for token in ("calendly", "termin buchen", "termin vereinbaren", "appointment", "booking"))
    emergency = any(token in lower for token in ("24h-notdienst", "24 stunden notdienst", "24/7", "notdienst"))
    careers = bool(links.get("careers")) or any(token in lower for token in ("karriere", "offene stellen", "stellenangebote", "wir suchen"))
    office_hiring = bool(OFFICE_HIRING_RE.search(combined_text))
    wordpress = "wp-content" in lower or "wp-json" in lower
    meta_pixel = "connect.facebook.net" in lower or "fbq(" in lower
    google_analytics = "googletagmanager.com" in lower or "google-analytics.com" in lower or "gtag(" in lower
    chat_widget = any(token in lower for token in ("intercom", "crisp.chat", "tawk.to", "tidio", "hubspot-messages"))

    signal_score = min(35, (12 if office_hiring else 0) + (8 if emergency else 0) + (5 if whatsapp else 0) + (4 if booking else 0) + (3 if not chat_widget else 0) + (3 if careers else 0))

    return {
        "companyId": target.companyId,
        "url": base,
        "ok": True,
        "signals": {
            "emails": emails,
            "phones": phones,
            "decisionMakers": decision_makers,
            "whatsapp": whatsapp,
            "booking": booking,
            "emergencyService": emergency,
            "careersPage": links.get("careers", ""),
            "contactPage": links.get("contact", ""),
            "imprintPage": links.get("imprint", ""),
            "teamPage": links.get("team", ""),
            "officeHiringSignal": office_hiring,
            "wordpress": wordpress,
            "metaPixel": meta_pixel,
            "googleAnalytics": google_analytics,
            "chatWidget": chat_widget,
            "pagesCrawled": len(pages),
            "signalScoreBoost": signal_score,
            "sourceUrls": [item[0] for item in pages],
        },
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "scrapling-enricher", "adaptive": True}


@app.post("/v1/enrich")
async def enrich(payload: EnrichRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not _authorized(authorization):
        raise HTTPException(status_code=401, detail="Unauthorized")

    async def run(target: Target) -> dict[str, Any]:
        try:
            return await asyncio.to_thread(_extract_one, target)
        except Exception as exc:
            return {"companyId": target.companyId, "url": target.url, "ok": False, "error": str(exc)[:400]}

    results = await asyncio.gather(*(run(target) for target in payload.targets))
    return {"ok": True, "results": results}

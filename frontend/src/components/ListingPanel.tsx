import { X, ArrowUpDown, ChevronDown, ExternalLink } from "lucide-react";

import { useEffect, useLayoutEffect, useMemo, useCallback, useState, useRef } from "react";

import { useShallow } from "zustand/react/shallow";
import { useStore } from "@/lib/store";

import { loadListings } from "@/lib/data";

import { filterAndSortListings } from "@/lib/panelListings";

import type { SortMode } from "@/lib/types";

import ListingCard from "./ListingCard";

/** Amap-style labels: 地铁 / 轻轨 = metro; otherwise transit leg = bus. */

function isMetroTransitLine(line: string | undefined): boolean {
  const l = line ?? "";

  return l.includes("地铁") || l.includes("轻轨");
}

function transitLegEmoji(line: string | undefined): string {
  return isMetroTransitLine(line) ? "Ⓜ️" : "🚌";
}

/** Metro routes like 地铁4号线(…) → "4 line" when a 号线 number is present. */

function formatTransitLineLabel(line: string | undefined): string {
  const l = line ?? "";

  if (!isMetroTransitLine(l)) return l;

  const m = l.match(/(?:地铁|轻轨)\s*(\d+)\s*号线/) || l.match(/(\d+)\s*号线/);

  if (m) return `${m[1]} line`;

  return l;
}

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "price-asc", label: "Price ↑" },

  { value: "price-desc", label: "Price ↓" },

  { value: "area-desc", label: "Area ↓" },

  { value: "area-asc", label: "Area ↑" },
];

export default function ListingPanel() {
  const [transitBreakdownOpen, setTransitBreakdownOpen] = useState(false);
  const [hideOffMarket, setHideOffMarket] = useState(true);
  const communityListScrollRef = useRef<HTMLDivElement>(null);

  const {
    selectedCommunity,
    selectedListings,
    loadingListings,

    selectCommunity,
    setSelectedListings,
    setLoadingListings,

    sort,
    setSort,
    appliedFilters,

    savedMapViewActive,
    setSavedMapViewActive,
    savedListings,

    mapFocusedListingId,
    setPanelListingOrderIds,
  } = useStore(
    useShallow((s) => ({
      selectedCommunity: s.selectedCommunity,
      selectedListings: s.selectedListings,
      loadingListings: s.loadingListings,
      selectCommunity: s.selectCommunity,
      setSelectedListings: s.setSelectedListings,
      setLoadingListings: s.setLoadingListings,
      sort: s.sort,
      setSort: s.setSort,
      appliedFilters: s.appliedFilters,
      savedMapViewActive: s.savedMapViewActive,
      setSavedMapViewActive: s.setSavedMapViewActive,
      savedListings: s.savedListings,
      mapFocusedListingId: s.mapFocusedListingId,
      setPanelListingOrderIds: s.setPanelListingOrderIds,
    })),
  );

  useEffect(() => {
    setTransitBreakdownOpen(false);
  }, [selectedCommunity?.id]);

  /** New community → show listings from the top (don’t keep prior scroll). */
  useLayoutEffect(() => {
    if (savedMapViewActive || !selectedCommunity?.id) return;
    const el = communityListScrollRef.current;
    if (el) el.scrollTop = 0;
  }, [selectedCommunity?.id, savedMapViewActive]);

  const fetchListings = useCallback(
    async (communityId: string) => {
      setLoadingListings(true);

      const data = await loadListings(communityId);

      setSelectedListings(data);
    },
    [setLoadingListings, setSelectedListings],
  );

  useEffect(() => {
    if (selectedCommunity && !savedMapViewActive) {
      fetchListings(selectedCommunity.id);
    }
  }, [selectedCommunity, savedMapViewActive, fetchListings]);

  const metaByListingId = useMemo(() => {
    const m = new Map<number, { communityId: string; communityName: string }>();
    for (const s of savedListings) {
      m.set(s.listing.id, {
        communityId: s.communityId,
        communityName: s.communityName,
      });
    }
    return m;
  }, [savedListings]);

  const filteredCommunityListings = useMemo(() => {
    if (!selectedListings) return [];

    return filterAndSortListings(selectedListings, appliedFilters, sort);
  }, [selectedListings, appliedFilters, sort]);

  const filteredSavedListings = useMemo(() => {
    let listings = savedListings.map((s) => s.listing);
    if (hideOffMarket) {
      listings = listings.filter((l) => !l.title.includes('【已下架】'));
    }
    return filterAndSortListings(listings, appliedFilters, sort);
  }, [savedListings, appliedFilters, sort, hideOffMarket]);

  useLayoutEffect(() => {
    if (savedMapViewActive) {
      setPanelListingOrderIds(filteredSavedListings.map((l) => l.id));
    } else if (selectedCommunity) {
      setPanelListingOrderIds(filteredCommunityListings.map((l) => l.id));
    } else {
      setPanelListingOrderIds([]);
    }
  }, [
    savedMapViewActive,
    selectedCommunity,
    filteredSavedListings,
    filteredCommunityListings,
    setPanelListingOrderIds,
  ]);

  useEffect(() => {
    if (mapFocusedListingId == null) return;
    const id = mapFocusedListingId;
    const h = requestAnimationFrame(() => {
      document
        .getElementById(`guamap-listing-card-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => cancelAnimationFrame(h);
  }, [mapFocusedListingId]);

  if (!savedMapViewActive && !selectedCommunity) return null;

  const currentSort = SORT_OPTIONS.find((s) => s.value === sort);

  const sortIdx = SORT_OPTIONS.findIndex((s) => s.value === sort);

  /** Saved-listings mode: full-width panel of ListingCards */

  if (savedMapViewActive) {
    return (
      <aside className="w-[383px] bg-white border-l border-[var(--color-border)] flex flex-col h-full overflow-hidden shrink-0">
        <div className="px-5 pt-3 pb-3 relative  border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => setSavedMapViewActive(false)}
            className="absolute top-4 right-4 w-7 h-7 rounded-full hover:bg-gray-100 flex items-center justify-center cursor-pointer"
            aria-label="Close saved listings"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>

          <h2 className="text-2xl font-medium text-[var(--color-text)] pr-8 leading-snug">
            Saved listings
          </h2>
        </div>

        <div className="px-5 py-3 flex items-center gap-3">
          <span className="font-['Lexend_Zetta'] font-semibold text-sm text-[var(--color-text)] shrink-0">
            {filteredSavedListings.length} listing
            {filteredSavedListings.length !== 1 ? "s" : ""}
          </span>

          <div className="ml-auto flex items-center bg-[var(--color-text)] text-white rounded-[10px] text-xs font-medium">
            <button
              type="button"
              onClick={() =>
                setSort(SORT_OPTIONS[(sortIdx + 1) % SORT_OPTIONS.length].value)
              }
              className="flex items-center gap-1 pl-3 pr-2 py-1.5 hover:bg-black/80 transition-colors rounded-l-[10px] cursor-pointer"
            >
              <ArrowUpDown className="w-3 h-3" />
              {currentSort?.label}
            </button>
            <div className="w-[1px] h-3.5 bg-white/30" />
            <label 
              className="pl-2 pr-3 py-1.5 flex items-center justify-center hover:bg-black/80 transition-colors rounded-r-[10px] cursor-pointer"
              title="Show only available listings"
            >
              <input 
                type="checkbox" 
                checked={hideOffMarket} 
                onChange={(e) => setHideOffMarket(e.target.checked)}
                className="w-3 h-3 rounded-sm border-white/40 bg-white/10 text-black focus:ring-0 focus:ring-offset-0 cursor-pointer accent-black"
                style={{ accentColor: "black" }}
              />
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-[var(--color-bg-card)] rounded-t-[35px] px-3 py-6 space-y-3">
          {savedListings.length === 0 ? (
            <div className="text-center text-gray-400 py-8 px-2">
              No saved listings yet. Open a community and tap the star on a
              card.
            </div>
          ) : filteredSavedListings.length === 0 ? (
            <div className="text-center text-gray-400 py-8">
              No saved listings match your filters
            </div>
          ) : (
            filteredSavedListings.map((listing) => {
              const meta = metaByListingId.get(listing.id);

              return (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  communityId={meta?.communityId ?? ""}
                  communityName={meta?.communityName ?? ""}
                />
              );
            })
          )}
        </div>
      </aside>
    );
  }

  const comm = selectedCommunity!;

  return (
    <aside className="w-[383px] bg-white border-l border-[var(--color-border)] flex flex-col h-full overflow-hidden shrink-0">
      {/* Header */}

      <div className="px-5 pt-5 pb-3 relative">
        <div className="absolute top-4 right-4 flex items-center gap-1">
          {comm.anjukeId && (
            <a
              href={`https://guangzhou.anjuke.com/community/view/${comm.anjukeId}`}
              target="_blank"
              rel="noopener noreferrer"
              title="View community on Anjuke"
              className="w-7 h-7 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
            >
              <ExternalLink className="w-4 h-4 text-gray-400" />
            </a>
          )}
          <button
            onClick={() => selectCommunity(null)}
            className="w-7 h-7 rounded-full hover:bg-gray-100 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <h2 className="text-2xl font-medium text-[var(--color-text)] pr-13 leading-snug">
          {comm.name}
        </h2>

        <div className="flex flex-wrap gap-8 mt-4 text-sm justify-center items-center text-center">
          <div className="min-w-0">
            <p className="text-gray-400 font-semibold text-xs">District</p>

            <p className="text-[var(--color-text)]">{comm.district}</p>
          </div>

          <div className="min-w-0">
            <p className="text-gray-400 font-semibold text-xs">Block</p>

            <p className="text-[var(--color-text)]">{comm.block}</p>
          </div>

          {comm.buildDate && (
            <div className="min-w-0">
              <p className="text-gray-400 font-semibold text-xs">Build date</p>

              <p className="text-[var(--color-text)]">{comm.buildDate}</p>
            </div>
          )}
        </div>

        {comm.transitMin > 0 && (
          <div className="mt-4 p-3 bg-[var(--color-bg-card)] rounded-xl">
            {comm.transitSegments.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => setTransitBreakdownOpen((o) => !o)}
                  className="flex w-full min-w-0 items-center justify-between gap-2 text-left rounded-lg -m-1 p-1 hover:bg-black/[0.04] transition-colors cursor-pointer"
                  aria-expanded={transitBreakdownOpen}
                  aria-controls="community-transit-breakdown"
                  id="community-transit-toggle"
                >
                  <span className="text-xs font-semibold text-gray-400 shrink-0">
                    Transit to SCUT
                  </span>

                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold text-[var(--color-text)]">
                      {comm.transitMin} min
                    </span>

                    <ChevronDown
                      className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${transitBreakdownOpen ? "rotate-180" : ""}`}
                      aria-hidden
                    />
                  </span>
                </button>

                {transitBreakdownOpen && (
                  <div
                    id="community-transit-breakdown"
                    className="space-y-1 mt-3 pt-2 border-t border-[var(--color-border)]"
                    role="region"
                    aria-labelledby="community-transit-toggle"
                  >
                    {comm.transitCost > 0 && (
                      <p className="text-xs text-gray-400 pb-2 mb-1 border-b border-[var(--color-border)]">
                        Cost: ¥{comm.transitCost}
                      </p>
                    )}

                    {comm.transitSegments.map((seg, i) => (
                      <div key={i} className="text-xs text-[var(--color-text)]">
                        {seg.type === "transit" ? (
                          <span>
                            {transitLegEmoji(seg.line)}{" "}
                            <span className="font-medium">
                              {formatTransitLineLabel(seg.line)}
                            </span>
                            <span className="text-gray-400">
                              {" "}
                              — {seg.from} → {seg.to} ({seg.stops} stops,{" "}
                              {Math.round(seg.dur / 60)} min)
                            </span>
                          </span>
                        ) : (
                          <span>
                            🚶 Walk {seg.dist ? `${seg.dist}m` : ""} (
                            {Math.round(seg.dur / 60)} min)
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-400">
                    Transit to SCUT
                  </span>

                  <span className="text-sm font-bold text-[var(--color-text)]">
                    {comm.transitMin} min
                  </span>
                </div>

                {comm.transitCost > 0 && (
                  <p className="text-xs text-gray-400 mt-2">
                    Cost: ¥{comm.transitCost}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Listings count + sort */}

      <div className="px-5 py-3 flex items-center gap-3">
        <span className="font-['Lexend_Zetta'] font-semibold text-sm text-[var(--color-text)]">
          {loadingListings
            ? "..."
            : `${filteredCommunityListings.length} Listing${filteredCommunityListings.length !== 1 ? "s" : ""}`}
        </span>

        <button
          onClick={() =>
            setSort(SORT_OPTIONS[(sortIdx + 1) % SORT_OPTIONS.length].value)
          }
          className="ml-auto flex items-center gap-1 px-3 py-1.5 bg-[var(--color-text)] text-white rounded-[10px] text-xs font-medium cursor-pointer hover:bg-black/80 transition-colors"
        >
          <ArrowUpDown className="w-3 h-3" />

          {currentSort?.label}
        </button>
      </div>

      {/* Listing cards */}

      <div
        ref={communityListScrollRef}
        className="flex-1 overflow-y-auto bg-[var(--color-bg-card)] rounded-t-[35px] px-3 py-6 space-y-3"
      >
        {loadingListings ? (
          <div className="text-center text-gray-400 py-8">
            Loading listings...
          </div>
        ) : filteredCommunityListings.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            No listings match your filters
          </div>
        ) : (
          filteredCommunityListings.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              communityId={comm.id}
              communityName={comm.name}
            />
          ))
        )}
      </div>
    </aside>
  );
}

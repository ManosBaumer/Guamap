import { X, ArrowUpDown, ExternalLink } from "lucide-react";

import { useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";

import { useShallow } from "zustand/react/shallow";
import { useStore } from "@/lib/store";

import { loadListings } from "@/lib/data";

import { filterAndSortListings, filteredSavedListings as getFilteredSavedListings } from "@/lib/panelListings";

import type { SortMode } from "@/lib/types";

import ListingCard from "./ListingCard";
import TransitPlannerPanel from "./TransitPlannerPanel";

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "price-asc", label: "Price ↑" },

  { value: "price-desc", label: "Price ↓" },

  { value: "area-desc", label: "Area ↓" },

  { value: "area-asc", label: "Area ↑" },
];

export default function ListingPanel() {
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
    hideOffMarket,
    setHideOffMarket,

    savedMapViewActive,
    setSavedMapViewActive,
    savedListings,

    mapFocusedListingId,
    setPanelListingOrderIds,
    transitPlannerOpen,
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
      hideOffMarket: s.hideOffMarket,
      setHideOffMarket: s.setHideOffMarket,
      savedMapViewActive: s.savedMapViewActive,
      setSavedMapViewActive: s.setSavedMapViewActive,
      savedListings: s.savedListings,
      mapFocusedListingId: s.mapFocusedListingId,
      setPanelListingOrderIds: s.setPanelListingOrderIds,
      transitPlannerOpen: s.transitPlannerOpen,
    })),
  );

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

  const filteredSavedListings = useMemo(
    () => getFilteredSavedListings(savedListings, appliedFilters, sort, hideOffMarket),
    [savedListings, appliedFilters, sort, hideOffMarket],
  );

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

  if (transitPlannerOpen) {
    return <TransitPlannerPanel />
  }

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

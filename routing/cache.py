"""Load transit time cache; filter to valid stops (exclude sentinel)."""
import pandas as pd

from config import get_data_path, STOPS_WITH_TRANSIT_CSV, TRANSIT_NO_ROUTE_SENTINEL


def load_transit_cache() -> pd.DataFrame:
    """Load full stops_with_transit_times.csv."""
    path = get_data_path(STOPS_WITH_TRANSIT_CSV)
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path, encoding="utf-8-sig")


def get_valid_stops_for_analysis() -> pd.DataFrame:
    """
    Load transit cache and exclude stops with no route (sentinel or null).
    Returns DataFrame with lat, lon, transit_time_minutes (and stop_id).
    """
    df = load_transit_cache()
    if df.empty or "transit_time_minutes" not in df.columns:
        return pd.DataFrame()
    valid = df[
        df["transit_time_minutes"].notna()
        & (df["transit_time_minutes"] < TRANSIT_NO_ROUTE_SENTINEL - 1)
    ].copy()
    return valid

"""
Reg T margin model:
- Initial margin: 50% (need $50 cash to buy/short $100 of stock)
- Maintenance margin: 25% for longs, 30% for shorts
- Margin is only used when positions exceed available cash (borrowing)
"""

INITIAL_MARGIN_RATE = 0.50
LONG_MAINTENANCE_RATE = 0.25
SHORT_MAINTENANCE_RATE = 0.30


def calculate_margin_stats(cash: float, positions: list[dict]) -> dict:
    """
    Calculate margin statistics from cash + enriched positions.
    Each position dict should have: side, market_value (absolute).
    """
    long_value = sum(p["market_value"] for p in positions if p["side"] == "long")
    short_value = sum(p["market_value"] for p in positions if p["side"] == "short")

    # NAV = cash + long_value - short_value
    nav = cash + long_value - short_value

    # Gross and net exposure
    gross_exposure = long_value + short_value
    net_exposure = long_value - short_value

    # Margin used: only when actually borrowing (leveraged beyond equity)
    # If gross_exposure <= nav, the portfolio is fully funded — no margin
    margin_used = max(0, gross_exposure - nav)

    # Maintenance requirement
    long_maintenance = long_value * LONG_MAINTENANCE_RATE
    short_maintenance = short_value * SHORT_MAINTENANCE_RATE
    maintenance_requirement = long_maintenance + short_maintenance

    # Excess margin
    excess_margin = nav - maintenance_requirement

    margin_call = nav < maintenance_requirement and gross_exposure > 0

    # Leverage ratio
    leverage = gross_exposure / nav if nav > 0 else 0

    return {
        "nav": round(nav, 2),
        "cash": round(cash, 2),
        "long_value": round(long_value, 2),
        "short_value": round(short_value, 2),
        "gross_exposure": round(gross_exposure, 2),
        "net_exposure": round(net_exposure, 2),
        "margin_used": round(margin_used, 2),
        "maintenance_requirement": round(maintenance_requirement, 2),
        "excess_margin": round(excess_margin, 2),
        "margin_call": margin_call,
        "leverage": round(leverage, 2),
    }


def check_trade_margin(cash: float, positions: list[dict], trade_value: float, action: str) -> tuple[bool, str]:
    """
    Check if a trade is allowed given current margin.
    trade_value = shares * price (always positive)
    Returns (allowed, reason).
    """
    if action == "buy":
        # For buys: need enough cash
        if cash < trade_value:
            return False, f"Insufficient cash. Need ${trade_value:,.2f}, have ${cash:,.2f}"
    elif action == "short":
        # For shorts: need margin collateral (50% of short value)
        required = trade_value * INITIAL_MARGIN_RATE
        stats = calculate_margin_stats(cash, positions)
        available = stats["excess_margin"]
        if available < required:
            return False, f"Insufficient margin for short. Need ${required:,.2f} collateral, have ${available:,.2f} excess margin"

    return True, "OK"

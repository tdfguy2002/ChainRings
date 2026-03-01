import math

CHAIN_ROLLER_RADIUS = 3.97  # mm


def pitch_circle_radius(N: int, pitch: float) -> float:
    return pitch / (2 * math.sin(math.pi / N))


def _chain_length(R1: float, R2: float, D: float) -> float:
    K = R1 - R2
    L_span = math.sqrt(D * D - K * K)
    phi1 = math.pi + 2 * math.asin(K / D)
    phi2 = math.pi - 2 * math.asin(K / D)
    return 2 * L_span + R1 * phi1 + R2 * phi2


def _center_for_links(R1: float, R2: float, pitch: float, target_links: int, D_init: float) -> float:
    """Newton's method: find D such that chain_length(D) == target_links * pitch."""
    target = target_links * pitch
    K = R1 - R2
    D = D_init
    for _ in range(60):
        L_span = math.sqrt(D * D - K * K)
        f  = _chain_length(R1, R2, D) - target
        fp = 2 * L_span / D          # derivative d(chain_length)/dD
        step = f / fp
        D -= step
        if abs(step) < 1e-10:
            break
    return D


def compute_geometry(
    teeth1: int, teeth2: int, center_distance: float, pitch: float
) -> dict:
    R1 = pitch_circle_radius(teeth1, pitch)
    R2 = pitch_circle_radius(teeth2, pitch)
    D = center_distance

    if R1 + R2 >= D:
        raise ValueError("Rings overlap: center distance too small.")
    if abs(R1 - R2) >= D:
        raise ValueError("One ring contains the other: center distance too small.")

    # Open-wrap (external tangent) scalars
    a = (R1 - R2) / D        # sin of offset angle
    b = math.sqrt(1.0 - a * a)

    # Tangent contact points (C1 at origin, C2 at (D, 0))
    P_top_1 = (R1 * a,      R1 * b)
    P_top_2 = (D + R2 * a,  R2 * b)
    P_bot_1 = (R1 * a,     -R1 * b)
    P_bot_2 = (D + R2 * a, -R2 * b)

    L_span = math.sqrt(D ** 2 - (R1 - R2) ** 2)

    phi1 = math.pi + 2 * math.asin((R1 - R2) / D)  # ring 1, long arc (back side)
    phi2 = math.pi - 2 * math.asin((R1 - R2) / D)  # ring 2, short arc (front side)

    chain_length = 2 * L_span + R1 * phi1 + R2 * phi2
    raw_links = chain_length / pitch
    lower_even = int(raw_links // 2) * 2
    upper_even = lower_even + 2
    if (raw_links - lower_even) <= (upper_even - raw_links):
        num_links = lower_even
    else:
        num_links = upper_even

    adjusted_center = _center_for_links(R1, R2, pitch, num_links, D)

    # Arc angles in math space (CCW from +x axis)
    # Ring 1: from P_bot_1 to P_top_1, counterclockwise (long arc, around the back)
    angle1_start = math.atan2(-b, a)  # angle to P_bot_1
    angle1_end   = math.atan2( b, a)  # angle to P_top_1

    # Ring 2: from P_top_2 to P_bot_2, clockwise (short arc, facing ring 1)
    angle2_start = math.atan2( b, a)  # angle to P_top_2 from C2
    angle2_end   = math.atan2(-b, a)  # angle to P_bot_2 from C2

    ring1_angles = [2 * math.pi * i / teeth1 for i in range(teeth1)]
    ring2_angles = [2 * math.pi * i / teeth2 for i in range(teeth2)]

    return {
        "ring1": {"cx": 0.0, "cy": 0.0, "radius": R1},
        "ring2": {"cx": float(D), "cy": 0.0, "radius": R2},
        "tangents": [
            {"x1": P_top_1[0], "y1": P_top_1[1],
             "x2": P_top_2[0], "y2": P_top_2[1]},
            {"x1": P_bot_2[0], "y1": P_bot_2[1],
             "x2": P_bot_1[0], "y2": P_bot_1[1]},
        ],
        "arcs": [
            {
                "cx": 0.0, "cy": 0.0, "radius": R1,
                "start_angle": angle1_start,
                "end_angle":   angle1_end,
                "counterclockwise": True,
            },
            {
                "cx": float(D), "cy": 0.0, "radius": R2,
                "start_angle": angle2_start,
                "end_angle":   angle2_end,
                "counterclockwise": True,
            },
        ],
        "chain_length":    round(chain_length, 4),
        "num_links":       num_links,
        "adjusted_center": round(adjusted_center, 4),
        "wrap_angle1":     round(math.degrees(phi1), 2),
        "wrap_angle2":     round(math.degrees(phi2), 2),
        "teeth_angles": {
            "ring1": ring1_angles,
            "ring2": ring2_angles,
        },
    }

import os
from datetime import datetime, timezone, timedelta
from typing import Dict

import boto3
from botocore.exceptions import ClientError
from fastapi import HTTPException

DAILY_CHAT_LIMIT = int(os.getenv("DAILY_CHAT_LIMIT", "5"))
RATE_LIMIT_TABLE = os.getenv("RATE_LIMIT_TABLE", "")
RATE_LIMIT_PK = "GLOBAL"

_local_counts: Dict[str, int] = {}
_dynamodb = None


def _today_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _ttl_epoch() -> int:
    tomorrow = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) + timedelta(days=2)
    return int(tomorrow.timestamp())


def _table():
    global _dynamodb
    if not RATE_LIMIT_TABLE:
        return None
    if _dynamodb is None:
        _dynamodb = boto3.resource("dynamodb")
    return _dynamodb.Table(RATE_LIMIT_TABLE)


def get_usage() -> Dict:
    day = _today_key()
    table = _table()
    used = 0

    if table is None:
        used = _local_counts.get(day, 0)
    else:
        try:
            item = table.get_item(Key={"pk": RATE_LIMIT_PK, "sk": day}).get("Item")
            if item:
                used = int(item.get("count", 0))
        except ClientError as e:
            print(f"Rate limit read error: {e}")
            raise HTTPException(status_code=500, detail="Unable to read usage quota")

    remaining = max(DAILY_CHAT_LIMIT - used, 0)
    return {
        "used": used,
        "remaining": remaining,
        "daily_limit": DAILY_CHAT_LIMIT,
        "resets_at": f"{day}T24:00:00Z",
        "timezone": "UTC",
    }


def reserve_slot() -> int:
    day = _today_key()
    table = _table()

    if table is None:
        used = _local_counts.get(day, 0)
        if used >= DAILY_CHAT_LIMIT:
            raise HTTPException(
                status_code=429,
                detail={
                    "message": "This demo has reached its shared daily chat limit. Come back tomorrow (UTC) — the cap keeps Bedrock costs predictable for a public portfolio project.",
                    "remaining": 0,
                    "daily_limit": DAILY_CHAT_LIMIT,
                    "resets_at": f"{day}T24:00:00Z",
                },
            )
        _local_counts[day] = used + 1
        return DAILY_CHAT_LIMIT - _local_counts[day]

    try:
        response = table.update_item(
            Key={"pk": RATE_LIMIT_PK, "sk": day},
            UpdateExpression="ADD #c :one SET #ttl = if_not_exists(#ttl, :ttl)",
            ConditionExpression="attribute_not_exists(#c) OR #c < :limit",
            ExpressionAttributeNames={"#c": "count", "#ttl": "ttl"},
            ExpressionAttributeValues={
                ":one": 1,
                ":limit": DAILY_CHAT_LIMIT,
                ":ttl": _ttl_epoch(),
            },
            ReturnValues="UPDATED_NEW",
        )
        used = int(response["Attributes"]["count"])
        return max(DAILY_CHAT_LIMIT - used, 0)
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise HTTPException(
                status_code=429,
                detail={
                    "message": "This demo has reached its shared daily chat limit. Come back tomorrow (UTC) — the cap keeps Bedrock costs predictable for a public portfolio project.",
                    "remaining": 0,
                    "daily_limit": DAILY_CHAT_LIMIT,
                    "resets_at": f"{day}T24:00:00Z",
                },
            )
        print(f"Rate limit reserve error: {e}")
        raise HTTPException(status_code=500, detail="Unable to reserve chat quota")


def release_slot() -> None:
    day = _today_key()
    table = _table()

    if table is None:
        used = _local_counts.get(day, 0)
        _local_counts[day] = max(used - 1, 0)
        return

    try:
        table.update_item(
            Key={"pk": RATE_LIMIT_PK, "sk": day},
            UpdateExpression="ADD #c :neg",
            ConditionExpression="attribute_exists(#c) AND #c > :zero",
            ExpressionAttributeNames={"#c": "count"},
            ExpressionAttributeValues={":neg": -1, ":zero": 0},
        )
    except ClientError as e:
        if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
            print(f"Rate limit release error: {e}")

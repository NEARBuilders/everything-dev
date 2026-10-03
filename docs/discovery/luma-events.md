# Luma event imports

CityNode supports manual events and Luma calendar imports side by side. Luma owns imported event details and registration; CityNode stores a public discovery projection with node associations, publication state, provider event/calendar IDs and a last-refreshed timestamp. It does not create or edit events in Luma.

## Connection

Following [nearbuilders.org's integration](https://github.com/NEARBuilders/nearbuilders.org/blob/main/plugins/events/src/services/luma.ts), configure `LUMA_CALENDAR_API_KEYS` as a comma-separated server secret. Each key is scoped to one calendar. Declare it in the API's secrets list and configure its value in the deployment's secret store; local development uses the same environment variable. Keys never enter browser responses or database activity records. An empty value leaves manual events fully usable.

Luma requires a Plus subscription for API access. See [Luma's API setup](https://docs.luma.com/reference/getting-started-with-your-api) and [calendar event listing](https://docs.luma.com/reference/get_v1-calendars-events-list). Connect only calendars approved for public discovery. All authorized node editors can select the platform's connected public calendars; a calendar key does not confer editing access to another CityNode node.

## Editor workflow

1. Open the community editor and select a Luma calendar. The selection is saved and public approved events publish automatically.
2. Manage event details and registration in Luma. CityNode checks for updates every five minutes while the API is running; visits also trigger a due check in the background without delaying the public map.
3. Use **Add an event** for manual events. These remain independent of Luma.
4. Disconnect the calendar to withdraw its events from Explore. Manual events remain unchanged. Selecting another calendar replaces the connection.

Each node has one selected calendar. The same calendar can be selected by several nodes. Existing manual imports are not automatically connected: select the calendar once to enable ongoing updates.

## Synchronization rules

- A complete snapshot is saved atomically. Stable Luma event IDs preserve CityNode IDs across edits, removals and returns.
- Only public approved events are included; private/member-only events and guest-only addresses are excluded.
- Removed or newly private events disappear on the next successful check. Returned public events reappear automatically, unless explicitly hidden in CityNode by an editor or moderator.
- Moderation withdrawals remain hidden after sync. Manual events are never overwritten or withdrawn. A manually added event with the same URL on the same node is retained instead of duplicating it.
- Calendar changes and disconnection serialize with synchronization so an old snapshot cannot restore disconnected events.
- Provider failures, invalid public data, incomplete pagination and rate limits preserve the last complete snapshot. The editor shows a connection error and the server retries after five minutes.
- Fetches have an eight-second timeout per request and a twenty-page cap (up to 1,000 events). Larger calendars fail explicitly rather than silently removing unseen events. Keys and guest data never enter browser responses.
- The worker runs with the API service and stops when that service shuts down. The persisted connection and sync timestamps survive restarts.

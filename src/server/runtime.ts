import type { Response } from "express";
import type { BrowserStatus, FilterStatus, ScheduleStatus, SendStatus } from "./domain";

export type RuntimeState = {
  browserStatus: BrowserStatus;
  filterStatus: FilterStatus;
  sendStatus: SendStatus;
  scheduleStatus: ScheduleStatus;
  pauseReason: string | null;
  lastError: string | null;
  lastEventAt: string | null;
};

export const runtimeState: RuntimeState = {
  browserStatus: "not_connected",
  filterStatus: "idle",
  sendStatus: "idle",
  scheduleStatus: "disabled",
  pauseReason: null,
  lastError: null,
  lastEventAt: null
};

type AppEvent = {
  type: string;
  payload: unknown;
  at: string;
};

class EventHub {
  private clients = new Set<Response>();

  subscribe(res: Response) {
    this.clients.add(res);
    this.emitTo(res, {
      type: "state",
      payload: runtimeState,
      at: new Date().toISOString()
    });

    return () => {
      this.clients.delete(res);
    };
  }

  emit(type: string, payload: unknown) {
    const event = {
      type,
      payload,
      at: new Date().toISOString()
    };
    runtimeState.lastEventAt = event.at;

    for (const client of this.clients) {
      this.emitTo(client, event);
    }
  }

  private emitTo(res: Response, event: AppEvent) {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

export const eventHub = new EventHub();

export function updateRuntime(partial: Partial<RuntimeState>, eventType = "state") {
  Object.assign(runtimeState, partial);
  eventHub.emit(eventType, runtimeState);
}

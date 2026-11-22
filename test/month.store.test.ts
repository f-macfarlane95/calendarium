import { get, writable } from "svelte/store";
import { expect, test, vi } from "vitest";
import type { LeapDay } from "../src/schemas/calendar/timespans";
import {
    getEphemeralStore,
    ViewState,
    type StaticStore,
} from "../src/stores/calendar.store";
import { YearStore, YearStoreCache } from "../src/stores/years.store";
import { PRESET_CALENDARS } from "../src/utils/presets";

vi.mock("src/settings/settings.service", () => ({
    SettingsService: { save: vi.fn() },
}));

function fixture(leapDays: LeapDay[]) {
    const calendar = structuredClone(
        PRESET_CALENDARS.find((item) => item.name === "Gregorian Calendar")!
    );
    calendar.static.months[0].length = 5;
    calendar.static.leapDays = leapDays;
    calendar.static.overflow = false;
    const data = calendar.static;
    const store: StaticStore = {
        store: writable(calendar),
        staticData: writable(data),
        leapDays: writable(data.leapDays),
        months: writable(data.months),
        moons: writable(data.moons),
        weekdays: writable(data.weekdays),
        years: writable(data.years ?? []),
        eras: writable(data.eras ?? []),
        seasonal: writable(calendar.seasonal),
        seasons: writable(calendar.seasonal.seasons),
        weather: writable(calendar.seasonal.weather),
        staticConfiguration: writable({
            firstWeekDay: data.firstWeekDay,
            overflow: data.overflow,
            offset: data.offset,
            incrementDay: data.incrementDay,
            useCustomYears: data.useCustomYears,
            dayDisplayCallback: data.dayDisplayCallback,
        }),
        getDaysInAYear: () =>
            data.months.reduce((sum, month) => sum + month.length, 0),
    };
    return { calendar, store };
}

function weeksFor(leapDays: LeapDay[], year = 2024) {
    const { store } = fixture(leapDays);
    const month = new YearStore(year, store).getMonthFromCache(0);
    return get(month.daysAsWeeks);
}

function leapDay(name: string, after: number, interval = 1): LeapDay {
    return {
        id: name,
        name,
        type: "leapday",
        interval: [{ interval }],
        offset: 0,
        timespan: 0,
        intercalary: true,
        after,
    };
}

function actualDays(weeks: ReturnType<typeof weeksFor>) {
    return weeks.flat().filter((day) => day && day.number > 0);
}

test("renders leap days sharing a position consecutively without skipping later days", () => {
    const weeks = weeksFor([
        leapDay("First", 2),
        leapDay("Second", 2),
        leapDay("Third", 3),
    ]);
    expect(actualDays(weeks).map((day) => [day!.name, day!.number])).toEqual([
        [null, 1],
        [null, 2],
        ["First", 3],
        ["Second", 4],
        [null, 5],
        ["Third", 6],
        [null, 7],
        [null, 8],
    ]);
    expect(weeks.filter((week) => week.some((day) => day?.type === "leapday"))
        .map((week) => week.map((day) => day?.name))).toEqual([
        ["First"], ["Second"], ["Third"],
    ]);
});

test("renders consecutive leap days before the first day and after the last day", () => {
    const weeks = weeksFor([
        leapDay("Before 1", 0),
        leapDay("Before 2", 0),
        leapDay("After 1", 5),
        leapDay("After 2", 5),
    ]);
    const days = actualDays(weeks);
    expect(days.map((day) => [day!.name, day!.number])).toEqual([
        ["Before 1", 1],
        ["Before 2", 2],
        [null, 3],
        [null, 4],
        [null, 5],
        [null, 6],
        [null, 7],
        ["After 1", 8],
        ["After 2", 9],
    ]);
    expect(weeks.every((week) => week.length > 0)).toBe(true);
});

test("only inserts leap days whose conditions match the year", () => {
    const days = actualDays(weeksFor([
        leapDay("Every year", 2),
        leapDay("Every four years", 2, 4),
    ], 2025));
    expect(days.map((day) => day!.name)).toEqual([
        null, null, "Every year", null, null, null,
    ]);
});

test("keeps the weekday column after consecutive intercalary days", () => {
    const weeks = weeksFor([
        leapDay("First", 2),
        leapDay("Second", 2),
    ]);
    const followingWeek = weeks.find((week) =>
        week.some((day) => day?.number === 5)
    );
    expect(followingWeek?.slice(0, 3).map((day) => day?.number ?? null))
        .toEqual([null, null, 5]);
});

test("week navigation visits consecutive intercalary days and the following partial week", () => {
    const { calendar, store } = fixture([
        leapDay("First", 2),
        leapDay("Second", 2),
    ]);
    calendar.current = { year: 2024, month: 0, day: 1 };
    const ephemeral = getEphemeralStore(
        store.store,
        store,
        calendar,
        new YearStoreCache(store)
    );
    ephemeral.viewState.set(ViewState.Week);
    for (const day of [3, 4, 5]) {
        ephemeral.goToNext();
        expect(get(ephemeral.displaying).day).toBe(day);
    }
    for (const day of [4, 3, 1]) {
        ephemeral.goToPrevious();
        expect(get(ephemeral.displaying).day).toBe(day);
    }
});

test("week navigation crosses month boundaries with intercalary days at the end", () => {
    const { calendar, store } = fixture([
        leapDay("First", 5),
        leapDay("Second", 5),
    ]);
    calendar.current = { year: 2024, month: 0, day: 6 };
    const ephemeral = getEphemeralStore(
        store.store,
        store,
        calendar,
        new YearStoreCache(store)
    );
    ephemeral.viewState.set(ViewState.Week);
    ephemeral.goToNext();
    expect(get(ephemeral.displaying)).toEqual({ year: 2024, month: 0, day: 7 });
    ephemeral.goToNext();
    expect(get(ephemeral.displaying)).toEqual({ year: 2024, month: 1, day: 1 });
    ephemeral.goToPrevious();
    expect(get(ephemeral.displaying)).toEqual({ year: 2024, month: 0, day: 7 });
    ephemeral.goToPrevious();
    expect(get(ephemeral.displaying)).toEqual({ year: 2024, month: 0, day: 6 });
});

test("week navigation skips prior-month placeholders before an intercalary day", () => {
    const { calendar, store } = fixture([
        leapDay("First", 0),
        leapDay("Second", 0),
    ]);
    calendar.static.overflow = true;
    calendar.current = { year: 2024, month: 0, day: 1 };
    const ephemeral = getEphemeralStore(
        store.store,
        store,
        calendar,
        new YearStoreCache(store)
    );
    ephemeral.viewState.set(ViewState.Week);
    ephemeral.goToPrevious();
    expect(get(ephemeral.displaying).year).toBe(2023);
    expect(get(ephemeral.displaying).month).toBe(11);
    ephemeral.goToNext();
    expect(get(ephemeral.displaying)).toEqual({ year: 2024, month: 0, day: 1 });
    ephemeral.goToNext();
    expect(get(ephemeral.displaying).day).toBe(2);
});

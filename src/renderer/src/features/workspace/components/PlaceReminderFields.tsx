import { useState } from "react";
import { IconMapPin } from "@tabler/icons-react";

import type { TaskPlaceReminder } from "../domain-model/types";
import {
  PLACE_RADIUS_DEFAULT,
  formatPlaceCoordinates,
  formatRadius,
  parsePlaceCoordinates,
  placeRadiusOptions,
} from "../lib/placeReminder";
import { Field } from "./common";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * Taskの場所のリマインダー（#727）。スマホがこの場所に居続けたときに通知する条件。
 * 設定済みなら見出しの横に「名前 · 半径」を出し、曜日は何も選ばなければ「毎日」が選ばれた形にする。
 *
 * 入力欄は制御しない（defaultValueのまま）。ドロワーはフォームの最初の入力で同期的に描き直すため、
 * 制御した欄だと最初の1文字が元の値に戻される。表示のための値は、入力から写して持つだけにする。
 * 「外す」は、この部品を作り直して空の状態に戻す。
 */
export function PlaceReminderFields({ place }: { place: TaskPlaceReminder | null | undefined }) {
  const [generation, setGeneration] = useState(0);
  return (
    <PlaceReminderSection
      key={generation}
      place={generation === 0 ? place : null}
      onClear={() => setGeneration((value) => value + 1)}
    />
  );
}

function PlaceReminderSection({
  place,
  onClear,
}: {
  place: TaskPlaceReminder | null | undefined;
  onClear: () => void;
}) {
  const [name, setName] = useState(place?.name ?? "");
  const [coordinates, setCoordinates] = useState(place ? formatPlaceCoordinates(place) : "");
  const [radius, setRadius] = useState(place?.radius_m ?? PLACE_RADIUS_DEFAULT);
  const [days, setDays] = useState<number[]>(place?.days ?? []);
  // 「毎日」で曜日の選択をまとめて外すとき、曜日の欄を作り直すための番号。
  const [daysGeneration, setDaysGeneration] = useState(0);
  const configured = Boolean(name.trim() || coordinates.trim());
  const complete = Boolean(name.trim() && parsePlaceCoordinates(coordinates));

  return (
    <section className="drawer-subsection place-reminder">
      <div className="section-heading">
        <h2>場所</h2>
        {complete && (
          <span className="place-summary">
            <IconMapPin size={14} aria-hidden="true" />
            {name.trim()} · {formatRadius(radius)}
          </span>
        )}
        {configured && (
          <button className="text-button compact" type="button" onClick={onClear}>
            外す
          </button>
        )}
      </div>
      <Field label="名前">
        <input
          name="place_name"
          maxLength={80}
          defaultValue={place?.name ?? ""}
          onInput={(event) => setName(event.currentTarget.value)}
        />
      </Field>
      <div className="form-grid">
        <Field label="座標">
          <input
            name="place_coordinates"
            inputMode="decimal"
            placeholder="34.6937, 135.1956"
            defaultValue={place ? formatPlaceCoordinates(place) : ""}
            onInput={(event) => setCoordinates(event.currentTarget.value)}
          />
        </Field>
        <Field label="半径">
          <select
            name="place_radius_m"
            defaultValue={place?.radius_m ?? PLACE_RADIUS_DEFAULT}
            onChange={(event) => setRadius(Number(event.currentTarget.value))}
          >
            {placeRadiusOptions(place?.radius_m ?? PLACE_RADIUS_DEFAULT).map((meters) => (
              <option key={meters} value={meters}>
                {formatRadius(meters)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="place-days" role="group" aria-label="曜日">
        <label className={`place-day${days.length === 0 ? " is-selected" : ""}`}>
          <input
            type="checkbox"
            checked={days.length === 0}
            onChange={() => {
              setDays([]);
              setDaysGeneration((value) => value + 1);
            }}
          />
          毎日
        </label>
        <span className="place-days-choices" key={daysGeneration}>
          {WEEKDAY_LABELS.map((label, index) => (
            <label key={label} className={`place-day${days.includes(index) ? " is-selected" : ""}`}>
              <input
                type="checkbox"
                name="place_days"
                value={index}
                defaultChecked={days.includes(index)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setDays((current) =>
                    checked ? [...current, index] : current.filter((value) => value !== index),
                  );
                }}
              />
              {label}
            </label>
          ))}
        </span>
      </div>
      <div className="place-time">
        <input
          name="place_time_from"
          type="time"
          aria-label="開始"
          defaultValue={place?.time_from ?? ""}
        />
        <span aria-hidden="true">〜</span>
        <input
          name="place_time_to"
          type="time"
          aria-label="終了"
          defaultValue={place?.time_to ?? ""}
        />
      </div>
    </section>
  );
}

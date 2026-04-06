"use client";

import { useEffect, useState } from "react";

import { getSicknessLog, SICKNESS_KEY, type SicknessLog } from "@/lib/sickness";
import { subscribeAppDataChange } from "@/lib/storage";

export function useSicknessLog(): SicknessLog {
  const [log, setLog] = useState<SicknessLog>(() => getSicknessLog());

  useEffect(
    () =>
      subscribeAppDataChange((keys) => {
        if (keys.includes(SICKNESS_KEY)) {
          setLog(getSicknessLog());
        }
      }),
    [],
  );

  return log;
}
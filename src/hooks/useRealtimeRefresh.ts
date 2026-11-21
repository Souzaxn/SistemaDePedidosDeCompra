import { useEffect, useRef } from "react";
import {
  RealtimeTable,
  TECAR_REALTIME_EVENT,
  TecarRealtimeDetail,
} from "../lib/realtime";

export const useRealtimeRefresh = (
  tables: RealtimeTable[],
  onChange: (detail: TecarRealtimeDetail) => void,
) => {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const tableKey = tables.join(",");

  useEffect(() => {
    const acceptedTables = new Set(tableKey.split(","));
    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<TecarRealtimeDetail>).detail;
      if (detail.table === "*" || acceptedTables.has(detail.table)) {
        onChangeRef.current(detail);
      }
    };
    window.addEventListener(TECAR_REALTIME_EVENT, handleChange);
    return () => window.removeEventListener(TECAR_REALTIME_EVENT, handleChange);
  }, [tableKey]);
};

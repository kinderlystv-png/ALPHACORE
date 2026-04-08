"use client";

import { useEffect, useRef, useState } from "react";

import { SyncBlockingOverlay } from "@/components/sync-blocking-overlay";
import { reconcileHeysActualActivities } from "@/lib/heys-activity-sync";
import { initializeCloudSync } from "@/lib/storage";
import { useHeysSync } from "@/lib/use-heys-sync";

type CloudSyncBootstrapProps = {
  appRootId: string;
};

export function CloudSyncBootstrap({ appRootId }: CloudSyncBootstrapProps) {
  const { snapshot } = useHeysSync();
  const [cloudReady, setCloudReady] = useState(false);
  const lastAppliedSnapshotRef = useRef<string | null>(null);

  useEffect(() => {
    void initializeCloudSync().then(() => setCloudReady(true));
  }, []);

  useEffect(() => {
    if (!cloudReady || !snapshot?.syncedAt) return;
    if (lastAppliedSnapshotRef.current === snapshot.syncedAt) return;

    reconcileHeysActualActivities(snapshot);
    lastAppliedSnapshotRef.current = snapshot.syncedAt;
  }, [cloudReady, snapshot]);

  return <SyncBlockingOverlay appRootId={appRootId} />;
}
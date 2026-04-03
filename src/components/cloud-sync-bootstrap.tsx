"use client";

import { useEffect } from "react";

import { initializeCloudSync } from "@/lib/storage";

export function CloudSyncBootstrap() {
  useEffect(() => {
    void initializeCloudSync();
  }, []);

  return null;
}
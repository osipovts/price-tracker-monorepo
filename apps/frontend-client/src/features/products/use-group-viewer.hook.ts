import { createContext, useContext } from 'react';

/** Who looks at a group: its owner, who changes it, or an administrator, who only looks at it. */
export type GroupViewerType = 'owner' | 'administrator';

export const groupViewerContext = createContext<GroupViewerType>('owner');

export function useGroupViewer(): GroupViewerType {
  return useContext(groupViewerContext);
}

import { create } from 'zustand';
import { createAuthSlice } from './slices/authSlice';
import { createThemeSlice } from './slices/themeSlice';
import { createUiSlice } from './slices/uiSlice';
import { createSemanticSlice } from './slices/semanticSlice';
import { createDashboardSlice } from './slices/dashboardSlice';
import { createColorSchemeSlice } from './slices/colorSchemeSlice';
import { createAskSlice } from './slices/askSlice';
import { createAdminSlice } from './slices/adminSlice';
import { createWorkspaceSlice } from './slices/workspaceSlice';
import { createConsumptionSlice } from './slices/consumptionSlice';

export const useAppStore = create((...a) => ({
  ...createAuthSlice(...a),
  ...createThemeSlice(...a),
  ...createUiSlice(...a),
  ...createSemanticSlice(...a),
  ...createDashboardSlice(...a),
  ...createColorSchemeSlice(...a),
  ...createAskSlice(...a),
  ...createAdminSlice(...a),
  ...createWorkspaceSlice(...a),
  ...createConsumptionSlice(...a),
}));

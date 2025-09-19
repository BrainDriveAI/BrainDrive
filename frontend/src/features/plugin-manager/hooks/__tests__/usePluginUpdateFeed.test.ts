import { act, renderHook, waitFor } from '@testing-library/react';
import { usePluginUpdateFeed } from '../usePluginUpdateFeed';
import { useAuth } from '../../../../contexts/AuthContext';
import moduleService from '../../services/moduleService';

type MockedAuth = jest.MockedFunction<typeof useAuth>;
type MockedModuleService = {
  checkForUpdates: jest.Mock;
  updatePlugin: jest.Mock;
};

jest.mock('../../../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../services/moduleService', () => ({
  __esModule: true,
  default: {
    checkForUpdates: jest.fn(),
    updatePlugin: jest.fn(),
  },
}));

const mockedUseAuth = useAuth as unknown as MockedAuth;
const mockedModuleService = moduleService as unknown as MockedModuleService;

const mockUpdatePayload = [
  {
    plugin_id: 'plugin-1',
    plugin_name: 'Sample Plugin',
    current_version: '1.0.0',
    latest_version: '1.2.0',
    repo_url: 'https://example.com/plugin-1',
  },
];

describe('usePluginUpdateFeed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockedUseAuth.mockReturnValue({
      user: { id: 'user-123', username: 'Test User', email: 'test@example.com' } as any,
      isAuthenticated: true,
    } as any);
    mockedModuleService.checkForUpdates.mockResolvedValue(mockUpdatePayload);
    mockedModuleService.updatePlugin.mockResolvedValue(undefined);
  });

  it('fetches plugin updates on mount', async () => {
    const { result } = renderHook(() => usePluginUpdateFeed());

    await waitFor(() => expect(result.current.status === 'ready' || result.current.status === 'empty').toBe(true));

    expect(mockedModuleService.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(result.current.updates).toHaveLength(1);
    expect(result.current.updates[0].pluginName).toBe('Sample Plugin');
  });

  it('can dismiss a plugin update without deleting cache data', async () => {
    const { result } = renderHook(() => usePluginUpdateFeed());

    await waitFor(() => expect(result.current.status === 'ready' || result.current.status === 'empty').toBe(true));

    act(() => {
      result.current.dismiss('plugin-1');
    });

    expect(result.current.updates).toHaveLength(0);
    const cached = localStorage.getItem('pluginUpdates::user-123');
    expect(cached).toContain('"plugin-1"');
  });

  it('calls updatePlugin and removes the entry on success', async () => {
    const { result } = renderHook(() => usePluginUpdateFeed());

    await waitFor(() => expect(result.current.status === 'ready' || result.current.status === 'empty').toBe(true));

    await act(async () => {
      await result.current.triggerUpdate('plugin-1');
    });

    expect(mockedModuleService.updatePlugin).toHaveBeenCalledWith('plugin-1');
    expect(result.current.updates).toHaveLength(0);
    expect(result.current.status).toBe('empty');
  });

  it('refresh restores dismissed updates', async () => {
    const { result } = renderHook(() => usePluginUpdateFeed());

    await waitFor(() => expect(result.current.status === 'ready' || result.current.status === 'empty').toBe(true));

    act(() => {
      result.current.dismiss('plugin-1');
    });

    mockedModuleService.checkForUpdates.mockResolvedValueOnce(mockUpdatePayload);

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => expect(result.current.updates).toHaveLength(1));
    expect(mockedModuleService.checkForUpdates).toHaveBeenCalledTimes(2);
  });
});



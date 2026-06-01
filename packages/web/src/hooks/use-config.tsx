import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';

interface ConfigContextValue {
	timezone: string;
}

const ConfigContext = createContext<ConfigContextValue>({ timezone: 'UTC' });

export function ConfigProvider({ children }: { children: ReactNode }) {
	const [timezone, setTimezone] = useState('UTC');

	useEffect(() => {
		api
			.get<{ config: { timezone?: string } }>('/config')
			.then((d) => {
				if (d.config.timezone) setTimezone(d.config.timezone);
			})
			.catch(() => {});
	}, []);

	return <ConfigContext.Provider value={{ timezone }}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
	return useContext(ConfigContext);
}

export function useTimezone() {
	return useContext(ConfigContext).timezone;
}

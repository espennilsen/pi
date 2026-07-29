/**
 * CRM Configuration types.
 */

export interface CrmConfig {
	/** Whether to enable reminders */
	reminders?: {
		enabled?: boolean;
		channel?: string;
	};
}

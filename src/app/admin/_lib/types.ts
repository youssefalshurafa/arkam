// Shared types for the admin panel, consolidated so the route screens
// (users / requests / resets / user-detail) and the shell all agree on shape.

export type Workspace = {
 id: string;
 name: string;
 slug: string;
 role: string;
 isOwner: boolean;
};

export type AdminUser = {
 id: string;
 email: string;
 name: string;
 image: string | null;
 authProvider: 'credentials' | 'oauth';
 createdAt: string;
 status: 'pending' | 'approved' | 'rejected' | null;
 phone: string | null;
 subscriptionStartedAt: string | null;
 subscriptionEndsAt: string | null;
 workspaceCount: number;
 workspaces: Workspace[];
};

export type Stats = {
 totalUsers: number;
 totalWorkspaces: number;
 credentialUsers: number;
 oauthUsers: number;
};

export type AccessRequest = {
 id: string;
 userId: string;
 email: string;
 name: string;
 plan: string;
 amount: string;
 network: string;
 txReference: string;
 proofMime: string;
 hasProof: boolean;
 status: 'pending' | 'approved' | 'rejected';
 note: string;
 createdAt: string;
 reviewedAt: string | null;
 userStatus: 'pending' | 'approved' | 'rejected';
 phone: string;
 company: string;
 country: string;
 subscriptionStartedAt: string | null;
 subscriptionEndsAt: string | null;
};

export type PasswordResetRequest = {
 id: string;
 userId: string;
 email: string;
 name: string;
 phone: string;
 note: string;
 status: 'pending' | 'approved' | 'rejected';
 createdAt: string;
 reviewedAt: string | null;
};

// ----- User detail -----
export type WorkspaceStats = {
 organizationCount: number;
 clientCount: number;
 accountCount: number;
 transactionCount: number;
 adjustmentCount: number;
 lastTransactionAt: string | null;
};

export type WorkspaceDetail = Workspace & {
 createdAt: string;
 stats: WorkspaceStats;
};

export type UserDetail = {
 id: string;
 email: string;
 name: string;
 image: string | null;
 authProvider: 'credentials' | 'oauth';
 createdAt: string;
 status: 'pending' | 'approved' | 'rejected';
 phone: string;
 subscriptionStartedAt: string | null;
 subscriptionEndsAt: string | null;
};

export type PendingAccessRequest = {
 id: string;
 plan: string;
 amount: string;
 network: string;
 txReference: string;
 hasProof: boolean;
 createdAt: string;
};

export type SectionVisit = {
 section: string;
 // todayCount resets daily — it's a live filter over the event log (server calendar day),
 // not a stored counter. totalCount is the all-time figure alongside it.
 todayCount: number;
 totalCount: number;
 lastVisitAt: string | null;
};

export type ActivitySummary = {
 appOpenCount: number;
 lastAppOpenAt: string | null;
 loginCount: number;
 lastLoginAt: string | null;
 lastActiveAt: string | null;
 sectionVisits: SectionVisit[];
};

export type DetailResponse = {
 user: UserDetail;
 workspaces: WorkspaceDetail[];
 totals: WorkspaceStats;
 pendingAccessRequest: PendingAccessRequest | null;
 activity: ActivitySummary;
};

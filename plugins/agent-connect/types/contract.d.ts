import "@orpc/openapi/extensions/route";
import { z } from "zod";
export declare const contract: {
    agentCreate: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        name: z.ZodString;
        policy: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        idempotencyKey: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodCustom<{
        correlation_id: string;
        type: "agent_create" | "policy_update" | "agent_freeze" | "agent_unfreeze" | "grant_issue" | "grant_revoke" | "execution_cancel" | "agent_archive" | "agent_restore" | "agent_delete" | "approval_vote";
        agent_id: string;
        status: "PENDING_SIGNATURE";
        expires_at: string;
        signer: {
            type: "near";
            account_id: string;
            public_key: string;
        } | {
            type: "evm";
            address: string;
            chain_id: number;
            public_key: string;
        } | {
            type: "passkey";
            credential_id: string;
            public_key: string;
            rp_id: string;
            origin: string;
        };
        intent: {
            standard: "nep413";
            payload: {
                message: string;
                recipient: string;
                nonce: string;
            };
        } | {
            standard: "nep366";
            payload: {
                receiverId: string;
                actions: {
                    type: "FunctionCall";
                    params: {
                        methodName: string;
                        args: {
                            [key: string]: unknown;
                        };
                        gas: string;
                        deposit: string;
                    };
                }[];
            };
        } | {
            standard: "eip712";
            payload: {
                domain: {
                    [key: string]: unknown;
                };
                types: {
                    [key: string]: {
                        name: string;
                        type: string;
                    }[];
                };
                primaryType: string;
                message: {
                    [key: string]: unknown;
                };
            };
        } | {
            standard: "webauthn";
            payload: {
                challenge: string;
                rpId: string;
                allowCredentials: {
                    id: string;
                    type: "public-key";
                }[];
                userVerification: "required";
                timeout: number;
            };
        };
        preview: {
            summary: string;
            revision?: number;
            previous_revision?: number;
            policy_hash?: string;
            policy?: {
                frozen: boolean;
                actions: ("swap" | "transfer" | "withdraw")[];
                confidential: boolean;
                owner_approval: boolean;
                assets: "any" | string[];
                limits: {
                    per_transaction?: {
                        [key: string]: string;
                    };
                    hourly?: {
                        [key: string]: string;
                    };
                    daily?: {
                        [key: string]: string;
                    };
                    monthly?: {
                        [key: string]: string;
                    };
                };
                max_actions_per_hour: number | null;
                destinations: {
                    mode: "any" | "only" | "except";
                    list: ({
                        action: "withdraw";
                        chain: string;
                        address: string;
                        memo: string | null;
                    } | {
                        action: "transfer";
                        address: string;
                        confidential: boolean;
                    })[];
                };
                budget: {
                    daily_usd: string | null;
                    weekly_usd: string | null;
                    monthly_usd: string | null;
                };
                timelock_ms: number;
                schedule?: {
                    mode: "only" | "except";
                    time_zone: string;
                    windows: {
                        days: ("mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")[];
                        start: string;
                        end: string;
                    }[];
                };
                sign?: {
                    recipients: string[];
                };
            };
            deletion?: {
                near_account_id: string;
                beneficiary: string;
                native_balance: string;
                public: {
                    asset_id: string;
                    symbol: string | null;
                    decimals: number | null;
                    blockchain: string | null;
                    price: number | null;
                    price_updated_at: string | null;
                    price_expires_at: string | null;
                    balance_raw: string;
                    balance: string | null;
                }[];
                confidential: {
                    asset_id: string;
                    symbol: string | null;
                    decimals: number | null;
                    blockchain: string | null;
                    price: number | null;
                    price_updated_at: string | null;
                    price_expires_at: string | null;
                    balance_raw: string;
                    balance: string | null;
                }[];
                assets_lost: boolean;
                retirement: "provider_delete" | "credential_erase";
            };
            approval?: {
                approval_id: string;
                request_type: string;
                request_hash: string;
                verdict: "approve" | "reject";
            };
        };
    }, {
        correlation_id: string;
        type: "agent_create" | "policy_update" | "agent_freeze" | "agent_unfreeze" | "grant_issue" | "grant_revoke" | "execution_cancel" | "agent_archive" | "agent_restore" | "agent_delete" | "approval_vote";
        agent_id: string;
        status: "PENDING_SIGNATURE";
        expires_at: string;
        signer: {
            type: "near";
            account_id: string;
            public_key: string;
        } | {
            type: "evm";
            address: string;
            chain_id: number;
            public_key: string;
        } | {
            type: "passkey";
            credential_id: string;
            public_key: string;
            rp_id: string;
            origin: string;
        };
        intent: {
            standard: "nep413";
            payload: {
                message: string;
                recipient: string;
                nonce: string;
            };
        } | {
            standard: "nep366";
            payload: {
                receiverId: string;
                actions: {
                    type: "FunctionCall";
                    params: {
                        methodName: string;
                        args: {
                            [key: string]: unknown;
                        };
                        gas: string;
                        deposit: string;
                    };
                }[];
            };
        } | {
            standard: "eip712";
            payload: {
                domain: {
                    [key: string]: unknown;
                };
                types: {
                    [key: string]: {
                        name: string;
                        type: string;
                    }[];
                };
                primaryType: string;
                message: {
                    [key: string]: unknown;
                };
            };
        } | {
            standard: "webauthn";
            payload: {
                challenge: string;
                rpId: string;
                allowCredentials: {
                    id: string;
                    type: "public-key";
                }[];
                userVerification: "required";
                timeout: number;
            };
        };
        preview: {
            summary: string;
            revision?: number;
            previous_revision?: number;
            policy_hash?: string;
            policy?: {
                frozen: boolean;
                actions: ("swap" | "transfer" | "withdraw")[];
                confidential: boolean;
                owner_approval: boolean;
                assets: "any" | string[];
                limits: {
                    per_transaction?: {
                        [key: string]: string;
                    };
                    hourly?: {
                        [key: string]: string;
                    };
                    daily?: {
                        [key: string]: string;
                    };
                    monthly?: {
                        [key: string]: string;
                    };
                };
                max_actions_per_hour: number | null;
                destinations: {
                    mode: "any" | "only" | "except";
                    list: ({
                        action: "withdraw";
                        chain: string;
                        address: string;
                        memo: string | null;
                    } | {
                        action: "transfer";
                        address: string;
                        confidential: boolean;
                    })[];
                };
                budget: {
                    daily_usd: string | null;
                    weekly_usd: string | null;
                    monthly_usd: string | null;
                };
                timelock_ms: number;
                schedule?: {
                    mode: "only" | "except";
                    time_zone: string;
                    windows: {
                        days: ("mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")[];
                        start: string;
                        end: string;
                    }[];
                };
                sign?: {
                    recipients: string[];
                };
            };
            deletion?: {
                near_account_id: string;
                beneficiary: string;
                native_balance: string;
                public: {
                    asset_id: string;
                    symbol: string | null;
                    decimals: number | null;
                    blockchain: string | null;
                    price: number | null;
                    price_updated_at: string | null;
                    price_expires_at: string | null;
                    balance_raw: string;
                    balance: string | null;
                }[];
                confidential: {
                    asset_id: string;
                    symbol: string | null;
                    decimals: number | null;
                    blockchain: string | null;
                    price: number | null;
                    price_updated_at: string | null;
                    price_expires_at: string | null;
                    balance_raw: string;
                    balance: string | null;
                }[];
                assets_lost: boolean;
                retirement: "provider_delete" | "credential_erase";
            };
            approval?: {
                approval_id: string;
                request_type: string;
                request_hash: string;
                verdict: "approve" | "reject";
            };
        };
    }>, {
        UNAUTHORIZED: {
            message: string;
        };
        BAD_REQUEST: {
            message: string;
        };
        CONFLICT: {
            message: string;
        };
        SERVICE_UNAVAILABLE: {
            message: string;
        };
        TOO_MANY_REQUESTS: {
            message: string;
        };
        BAD_GATEWAY: {
            message: string;
        };
        INTERNAL_SERVER_ERROR: {
            message: string;
        };
    }>;
    agentList: import("@orpc/contract").ProcedureContract<import("@orpc/contract").InitialInputSchema, z.ZodCustom<{
        data: {
            id: string;
            name: string;
            external_user_id: string | null;
            status: "PENDING" | "ACTIVE" | "ARCHIVED" | "DELETED" | "ABANDONED";
            archived: boolean;
            deleted: boolean;
            owner: ({
                type: "near";
                account_id: string;
                public_key: string;
            } | {
                type: "evm";
                address: string;
                chain_id: number;
                public_key: string;
            } | {
                type: "passkey";
                credential_id: string;
                public_key: string;
                rp_id: string;
                origin: string;
            }) | null;
            owner_account: {
                account_id: string;
                public_key: string;
                authority: "wallet";
            } | null;
            wallet: {
                wallet_id: string;
                near_account_id: string;
            } | null;
            created_at: string;
            cooldowns: {
                policy_change_available_at: string | null;
                unfreeze_available_at: string | null;
            };
        }[];
        next_cursor: string | null;
    }, {
        data: {
            id: string;
            name: string;
            external_user_id: string | null;
            status: "PENDING" | "ACTIVE" | "ARCHIVED" | "DELETED" | "ABANDONED";
            archived: boolean;
            deleted: boolean;
            owner: ({
                type: "near";
                account_id: string;
                public_key: string;
            } | {
                type: "evm";
                address: string;
                chain_id: number;
                public_key: string;
            } | {
                type: "passkey";
                credential_id: string;
                public_key: string;
                rp_id: string;
                origin: string;
            }) | null;
            owner_account: {
                account_id: string;
                public_key: string;
                authority: "wallet";
            } | null;
            wallet: {
                wallet_id: string;
                near_account_id: string;
            } | null;
            created_at: string;
            cooldowns: {
                policy_change_available_at: string | null;
                unfreeze_available_at: string | null;
            };
        }[];
        next_cursor: string | null;
    }>, {
        UNAUTHORIZED: {
            message: string;
        };
        BAD_REQUEST: {
            message: string;
        };
        CONFLICT: {
            message: string;
        };
        TOO_MANY_REQUESTS: {
            message: string;
        };
        SERVICE_UNAVAILABLE: {
            message: string;
        };
        BAD_GATEWAY: {
            message: string;
        };
        INTERNAL_SERVER_ERROR: {
            message: string;
        };
    }>;
    agentGet: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        agentId: z.ZodString;
    }, z.core.$strip>, z.ZodCustom<{
        id: string;
        name: string;
        external_user_id: string | null;
        status: "PENDING" | "ACTIVE" | "ARCHIVED" | "DELETED" | "ABANDONED";
        archived: boolean;
        deleted: boolean;
        owner: ({
            type: "near";
            account_id: string;
            public_key: string;
        } | {
            type: "evm";
            address: string;
            chain_id: number;
            public_key: string;
        } | {
            type: "passkey";
            credential_id: string;
            public_key: string;
            rp_id: string;
            origin: string;
        }) | null;
        owner_account: {
            account_id: string;
            public_key: string;
            authority: "wallet";
        } | null;
        wallet: {
            wallet_id: string;
            near_account_id: string;
        } | null;
        created_at: string;
        cooldowns: {
            policy_change_available_at: string | null;
            unfreeze_available_at: string | null;
        };
    }, {
        id: string;
        name: string;
        external_user_id: string | null;
        status: "PENDING" | "ACTIVE" | "ARCHIVED" | "DELETED" | "ABANDONED";
        archived: boolean;
        deleted: boolean;
        owner: ({
            type: "near";
            account_id: string;
            public_key: string;
        } | {
            type: "evm";
            address: string;
            chain_id: number;
            public_key: string;
        } | {
            type: "passkey";
            credential_id: string;
            public_key: string;
            rp_id: string;
            origin: string;
        }) | null;
        owner_account: {
            account_id: string;
            public_key: string;
            authority: "wallet";
        } | null;
        wallet: {
            wallet_id: string;
            near_account_id: string;
        } | null;
        created_at: string;
        cooldowns: {
            policy_change_available_at: string | null;
            unfreeze_available_at: string | null;
        };
    }>, {
        UNAUTHORIZED: {
            message: string;
        };
        BAD_REQUEST: {
            message: string;
        };
        CONFLICT: {
            message: string;
        };
        TOO_MANY_REQUESTS: {
            message: string;
        };
        NOT_FOUND: {
            message: string;
        };
        SERVICE_UNAVAILABLE: {
            message: string;
        };
        BAD_GATEWAY: {
            message: string;
        };
        INTERNAL_SERVER_ERROR: {
            message: string;
        };
    }>;
    prepareIntent: import("@orpc/contract").ProcedureContract<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"agent_create">;
        name: z.ZodString;
        policy: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        idempotencyKey: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"grant_issue">;
        agentId: z.ZodString;
        label: z.ZodString;
        expiresAt: z.ZodOptional<z.ZodString>;
        idempotencyKey: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"grant_revoke">;
        agentId: z.ZodString;
        grantId: z.ZodString;
        idempotencyKey: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], "type">, z.ZodCustom<{
        correlation_id: string;
        type: "agent_create" | "policy_update" | "agent_freeze" | "agent_unfreeze" | "grant_issue" | "grant_revoke" | "execution_cancel" | "agent_archive" | "agent_restore" | "agent_delete" | "approval_vote";
        agent_id: string;
        status: "PENDING_SIGNATURE";
        expires_at: string;
        signer: {
            type: "near";
            account_id: string;
            public_key: string;
        } | {
            type: "evm";
            address: string;
            chain_id: number;
            public_key: string;
        } | {
            type: "passkey";
            credential_id: string;
            public_key: string;
            rp_id: string;
            origin: string;
        };
        intent: {
            standard: "nep413";
            payload: {
                message: string;
                recipient: string;
                nonce: string;
            };
        } | {
            standard: "nep366";
            payload: {
                receiverId: string;
                actions: {
                    type: "FunctionCall";
                    params: {
                        methodName: string;
                        args: {
                            [key: string]: unknown;
                        };
                        gas: string;
                        deposit: string;
                    };
                }[];
            };
        } | {
            standard: "eip712";
            payload: {
                domain: {
                    [key: string]: unknown;
                };
                types: {
                    [key: string]: {
                        name: string;
                        type: string;
                    }[];
                };
                primaryType: string;
                message: {
                    [key: string]: unknown;
                };
            };
        } | {
            standard: "webauthn";
            payload: {
                challenge: string;
                rpId: string;
                allowCredentials: {
                    id: string;
                    type: "public-key";
                }[];
                userVerification: "required";
                timeout: number;
            };
        };
        preview: {
            summary: string;
            revision?: number;
            previous_revision?: number;
            policy_hash?: string;
            policy?: {
                frozen: boolean;
                actions: ("swap" | "transfer" | "withdraw")[];
                confidential: boolean;
                owner_approval: boolean;
                assets: "any" | string[];
                limits: {
                    per_transaction?: {
                        [key: string]: string;
                    };
                    hourly?: {
                        [key: string]: string;
                    };
                    daily?: {
                        [key: string]: string;
                    };
                    monthly?: {
                        [key: string]: string;
                    };
                };
                max_actions_per_hour: number | null;
                destinations: {
                    mode: "any" | "only" | "except";
                    list: ({
                        action: "withdraw";
                        chain: string;
                        address: string;
                        memo: string | null;
                    } | {
                        action: "transfer";
                        address: string;
                        confidential: boolean;
                    })[];
                };
                budget: {
                    daily_usd: string | null;
                    weekly_usd: string | null;
                    monthly_usd: string | null;
                };
                timelock_ms: number;
                schedule?: {
                    mode: "only" | "except";
                    time_zone: string;
                    windows: {
                        days: ("mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")[];
                        start: string;
                        end: string;
                    }[];
                };
                sign?: {
                    recipients: string[];
                };
            };
            deletion?: {
                near_account_id: string;
                beneficiary: string;
                native_balance: string;
                public: {
                    asset_id: string;
                    symbol: string | null;
                    decimals: number | null;
                    blockchain: string | null;
                    price: number | null;
                    price_updated_at: string | null;
                    price_expires_at: string | null;
                    balance_raw: string;
                    balance: string | null;
                }[];
                confidential: {
                    asset_id: string;
                    symbol: string | null;
                    decimals: number | null;
                    blockchain: string | null;
                    price: number | null;
                    price_updated_at: string | null;
                    price_expires_at: string | null;
                    balance_raw: string;
                    balance: string | null;
                }[];
                assets_lost: boolean;
                retirement: "provider_delete" | "credential_erase";
            };
            approval?: {
                approval_id: string;
                request_type: string;
                request_hash: string;
                verdict: "approve" | "reject";
            };
        };
    }, {
        correlation_id: string;
        type: "agent_create" | "policy_update" | "agent_freeze" | "agent_unfreeze" | "grant_issue" | "grant_revoke" | "execution_cancel" | "agent_archive" | "agent_restore" | "agent_delete" | "approval_vote";
        agent_id: string;
        status: "PENDING_SIGNATURE";
        expires_at: string;
        signer: {
            type: "near";
            account_id: string;
            public_key: string;
        } | {
            type: "evm";
            address: string;
            chain_id: number;
            public_key: string;
        } | {
            type: "passkey";
            credential_id: string;
            public_key: string;
            rp_id: string;
            origin: string;
        };
        intent: {
            standard: "nep413";
            payload: {
                message: string;
                recipient: string;
                nonce: string;
            };
        } | {
            standard: "nep366";
            payload: {
                receiverId: string;
                actions: {
                    type: "FunctionCall";
                    params: {
                        methodName: string;
                        args: {
                            [key: string]: unknown;
                        };
                        gas: string;
                        deposit: string;
                    };
                }[];
            };
        } | {
            standard: "eip712";
            payload: {
                domain: {
                    [key: string]: unknown;
                };
                types: {
                    [key: string]: {
                        name: string;
                        type: string;
                    }[];
                };
                primaryType: string;
                message: {
                    [key: string]: unknown;
                };
            };
        } | {
            standard: "webauthn";
            payload: {
                challenge: string;
                rpId: string;
                allowCredentials: {
                    id: string;
                    type: "public-key";
                }[];
                userVerification: "required";
                timeout: number;
            };
        };
        preview: {
            summary: string;
            revision?: number;
            previous_revision?: number;
            policy_hash?: string;
            policy?: {
                frozen: boolean;
                actions: ("swap" | "transfer" | "withdraw")[];
                confidential: boolean;
                owner_approval: boolean;
                assets: "any" | string[];
                limits: {
                    per_transaction?: {
                        [key: string]: string;
                    };
                    hourly?: {
                        [key: string]: string;
                    };
                    daily?: {
                        [key: string]: string;
                    };
                    monthly?: {
                        [key: string]: string;
                    };
                };
                max_actions_per_hour: number | null;
                destinations: {
                    mode: "any" | "only" | "except";
                    list: ({
                        action: "withdraw";
                        chain: string;
                        address: string;
                        memo: string | null;
                    } | {
                        action: "transfer";
                        address: string;
                        confidential: boolean;
                    })[];
                };
                budget: {
                    daily_usd: string | null;
                    weekly_usd: string | null;
                    monthly_usd: string | null;
                };
                timelock_ms: number;
                schedule?: {
                    mode: "only" | "except";
                    time_zone: string;
                    windows: {
                        days: ("mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")[];
                        start: string;
                        end: string;
                    }[];
                };
                sign?: {
                    recipients: string[];
                };
            };
            deletion?: {
                near_account_id: string;
                beneficiary: string;
                native_balance: string;
                public: {
                    asset_id: string;
                    symbol: string | null;
                    decimals: number | null;
                    blockchain: string | null;
                    price: number | null;
                    price_updated_at: string | null;
                    price_expires_at: string | null;
                    balance_raw: string;
                    balance: string | null;
                }[];
                confidential: {
                    asset_id: string;
                    symbol: string | null;
                    decimals: number | null;
                    blockchain: string | null;
                    price: number | null;
                    price_updated_at: string | null;
                    price_expires_at: string | null;
                    balance_raw: string;
                    balance: string | null;
                }[];
                assets_lost: boolean;
                retirement: "provider_delete" | "credential_erase";
            };
            approval?: {
                approval_id: string;
                request_type: string;
                request_hash: string;
                verdict: "approve" | "reject";
            };
        };
    }>, {
        UNAUTHORIZED: {
            message: string;
        };
        NOT_FOUND: {
            message: string;
        };
        BAD_REQUEST: {
            message: string;
        };
        CONFLICT: {
            message: string;
        };
        SERVICE_UNAVAILABLE: {
            message: string;
        };
        TOO_MANY_REQUESTS: {
            message: string;
        };
        BAD_GATEWAY: {
            message: string;
        };
        INTERNAL_SERVER_ERROR: {
            message: string;
        };
    }>;
    intentSubmit: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        type: z.ZodEnum<{
            agent_create: "agent_create";
            grant_issue: "grant_issue";
            grant_revoke: "grant_revoke";
        }>;
        correlationId: z.ZodString;
        signedData: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, z.core.$strip>, z.ZodCustom<{
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_create";
        details: {
            revision: number | null;
            policy_hash: string | null;
            transaction_hash: string | null;
            agent_id: string;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "policy_update";
        details: {
            revision: number | null;
            policy_hash: string | null;
            transaction_hash: string | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_freeze";
        details: {
            revision: number | null;
            policy_hash: string | null;
            transaction_hash: string | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_unfreeze";
        details: {
            revision: number | null;
            policy_hash: string | null;
            transaction_hash: string | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "grant_issue";
        details: {
            grant: {
                grant_id: string;
                agent_id: string;
                wallet_id: string;
                label: string;
                issued_at: string;
                expires_at: string;
                revoked_at: string | null;
                revoked_reason: string | null;
                owner_epoch: number;
                owner_message: {
                    domain: "near-intents-agent-api.agent-grant.v6";
                    owner: {
                        type: "near";
                        account_id: string;
                        public_key: string;
                    } | {
                        type: "evm";
                        address: string;
                        chain_id: number;
                        public_key: string;
                    } | {
                        type: "passkey";
                        credential_id: string;
                        public_key: string;
                        rp_id: string;
                        origin: string;
                    };
                    tenant_id: string;
                    agent_id: string;
                    wallet_id: string;
                    label: string;
                    credential: string;
                    network: "mainnet";
                    issued_at_ms: number;
                    expires_at_ms: number;
                    owner_epoch: number;
                    nonce: string;
                    recipient: string;
                };
            } | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "grant_revoke";
        details: {
            grant_id: string | null;
            committed_correlation_ids: string[] | null;
            committed_truncated: boolean | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "execution_cancel";
        details: {
            cancelled_correlation_id: string | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_archive";
        details: {
            archived: boolean | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_restore";
        details: {
            archived: boolean | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_delete";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "approval_vote";
        details: {
            approval_id: string | null;
            verdict: ("approve" | "reject") | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "swap";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "withdraw";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "transfer";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "shield";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "unshield";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "deposit";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    }, {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_create";
        details: {
            revision: number | null;
            policy_hash: string | null;
            transaction_hash: string | null;
            agent_id: string;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "policy_update";
        details: {
            revision: number | null;
            policy_hash: string | null;
            transaction_hash: string | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_freeze";
        details: {
            revision: number | null;
            policy_hash: string | null;
            transaction_hash: string | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_unfreeze";
        details: {
            revision: number | null;
            policy_hash: string | null;
            transaction_hash: string | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "grant_issue";
        details: {
            grant: {
                grant_id: string;
                agent_id: string;
                wallet_id: string;
                label: string;
                issued_at: string;
                expires_at: string;
                revoked_at: string | null;
                revoked_reason: string | null;
                owner_epoch: number;
                owner_message: {
                    domain: "near-intents-agent-api.agent-grant.v6";
                    owner: {
                        type: "near";
                        account_id: string;
                        public_key: string;
                    } | {
                        type: "evm";
                        address: string;
                        chain_id: number;
                        public_key: string;
                    } | {
                        type: "passkey";
                        credential_id: string;
                        public_key: string;
                        rp_id: string;
                        origin: string;
                    };
                    tenant_id: string;
                    agent_id: string;
                    wallet_id: string;
                    label: string;
                    credential: string;
                    network: "mainnet";
                    issued_at_ms: number;
                    expires_at_ms: number;
                    owner_epoch: number;
                    nonce: string;
                    recipient: string;
                };
            } | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "grant_revoke";
        details: {
            grant_id: string | null;
            committed_correlation_ids: string[] | null;
            committed_truncated: boolean | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "execution_cancel";
        details: {
            cancelled_correlation_id: string | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_archive";
        details: {
            archived: boolean | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_restore";
        details: {
            archived: boolean | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_delete";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "approval_vote";
        details: {
            approval_id: string | null;
            verdict: ("approve" | "reject") | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "swap";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "withdraw";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "transfer";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "shield";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "unshield";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "deposit";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    }>, {
        UNAUTHORIZED: {
            message: string;
        };
        NOT_FOUND: {
            message: string;
        };
        BAD_REQUEST: {
            message: string;
        };
        CONFLICT: {
            message: string;
        };
        SERVICE_UNAVAILABLE: {
            message: string;
        };
        TOO_MANY_REQUESTS: {
            message: string;
        };
        BAD_GATEWAY: {
            message: string;
        };
        INTERNAL_SERVER_ERROR: {
            message: string;
        };
    }>;
    intentStatus: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        correlationId: z.ZodString;
        waitMs: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>, z.ZodCustom<{
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_create";
        details: {
            revision: number | null;
            policy_hash: string | null;
            transaction_hash: string | null;
            agent_id: string;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "policy_update";
        details: {
            revision: number | null;
            policy_hash: string | null;
            transaction_hash: string | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_freeze";
        details: {
            revision: number | null;
            policy_hash: string | null;
            transaction_hash: string | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_unfreeze";
        details: {
            revision: number | null;
            policy_hash: string | null;
            transaction_hash: string | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "grant_issue";
        details: {
            grant: {
                grant_id: string;
                agent_id: string;
                wallet_id: string;
                label: string;
                issued_at: string;
                expires_at: string;
                revoked_at: string | null;
                revoked_reason: string | null;
                owner_epoch: number;
                owner_message: {
                    domain: "near-intents-agent-api.agent-grant.v6";
                    owner: {
                        type: "near";
                        account_id: string;
                        public_key: string;
                    } | {
                        type: "evm";
                        address: string;
                        chain_id: number;
                        public_key: string;
                    } | {
                        type: "passkey";
                        credential_id: string;
                        public_key: string;
                        rp_id: string;
                        origin: string;
                    };
                    tenant_id: string;
                    agent_id: string;
                    wallet_id: string;
                    label: string;
                    credential: string;
                    network: "mainnet";
                    issued_at_ms: number;
                    expires_at_ms: number;
                    owner_epoch: number;
                    nonce: string;
                    recipient: string;
                };
            } | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "grant_revoke";
        details: {
            grant_id: string | null;
            committed_correlation_ids: string[] | null;
            committed_truncated: boolean | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "execution_cancel";
        details: {
            cancelled_correlation_id: string | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_archive";
        details: {
            archived: boolean | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_restore";
        details: {
            archived: boolean | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_delete";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "approval_vote";
        details: {
            approval_id: string | null;
            verdict: ("approve" | "reject") | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "swap";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "withdraw";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "transfer";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "shield";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "unshield";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "deposit";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    }, {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_create";
        details: {
            revision: number | null;
            policy_hash: string | null;
            transaction_hash: string | null;
            agent_id: string;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "policy_update";
        details: {
            revision: number | null;
            policy_hash: string | null;
            transaction_hash: string | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_freeze";
        details: {
            revision: number | null;
            policy_hash: string | null;
            transaction_hash: string | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_unfreeze";
        details: {
            revision: number | null;
            policy_hash: string | null;
            transaction_hash: string | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "grant_issue";
        details: {
            grant: {
                grant_id: string;
                agent_id: string;
                wallet_id: string;
                label: string;
                issued_at: string;
                expires_at: string;
                revoked_at: string | null;
                revoked_reason: string | null;
                owner_epoch: number;
                owner_message: {
                    domain: "near-intents-agent-api.agent-grant.v6";
                    owner: {
                        type: "near";
                        account_id: string;
                        public_key: string;
                    } | {
                        type: "evm";
                        address: string;
                        chain_id: number;
                        public_key: string;
                    } | {
                        type: "passkey";
                        credential_id: string;
                        public_key: string;
                        rp_id: string;
                        origin: string;
                    };
                    tenant_id: string;
                    agent_id: string;
                    wallet_id: string;
                    label: string;
                    credential: string;
                    network: "mainnet";
                    issued_at_ms: number;
                    expires_at_ms: number;
                    owner_epoch: number;
                    nonce: string;
                    recipient: string;
                };
            } | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "grant_revoke";
        details: {
            grant_id: string | null;
            committed_correlation_ids: string[] | null;
            committed_truncated: boolean | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "execution_cancel";
        details: {
            cancelled_correlation_id: string | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_archive";
        details: {
            archived: boolean | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_restore";
        details: {
            archived: boolean | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "agent_delete";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "approval_vote";
        details: {
            approval_id: string | null;
            verdict: ("approve" | "reject") | null;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "swap";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "withdraw";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "transfer";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "shield";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "unshield";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    } | {
        correlation_id: string;
        agent_id: string | null;
        status: "PENDING_SIGNATURE" | "QUEUED" | "PENDING_APPROVAL" | "PENDING_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "UNCERTAIN" | "NEEDS_REVIEW";
        failure_code: string | null;
        created_at: string;
        updated_at: string;
        dispatch_committed_at: string | null;
        grant: {
            id: string;
            label: string;
        } | null;
        type: "deposit";
        details: {
            action: string;
            near_account_id?: string;
            provider_request_id?: string | null;
            provider_status?: string;
            confidential?: boolean;
            chain?: string;
            execute_after?: string;
            delay_ms?: number;
            approval_id?: string | null;
            intent_hash?: string | null;
            tx_hash?: string | null;
            destination_tx_hash?: string | null;
            amount_out?: string | null;
            deposit_address?: string | null;
            memo?: string | null;
            min_amount?: string | null;
            min_amount_out?: string | null;
            expires_at?: string | null;
            refund_to?: string | null;
            refund_tx_hash?: string | null;
            failure_reason?: string | null;
        } & {
            [key: string]: unknown;
        };
    }>, {
        UNAUTHORIZED: {
            message: string;
        };
        NOT_FOUND: {
            message: string;
        };
        SERVICE_UNAVAILABLE: {
            message: string;
        };
        TOO_MANY_REQUESTS: {
            message: string;
        };
        BAD_GATEWAY: {
            message: string;
        };
        INTERNAL_SERVER_ERROR: {
            message: string;
        };
    }>;
    grantList: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        agentId: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        data: z.ZodArray<z.ZodCustom<{
            grant_id: string;
            agent_id: string;
            wallet_id: string;
            label: string;
            issued_at: string;
            expires_at: string;
            revoked_at: string | null;
            revoked_reason: string | null;
            owner_epoch: number;
            owner_message: {
                domain: "near-intents-agent-api.agent-grant.v6";
                owner: {
                    type: "near";
                    account_id: string;
                    public_key: string;
                } | {
                    type: "evm";
                    address: string;
                    chain_id: number;
                    public_key: string;
                } | {
                    type: "passkey";
                    credential_id: string;
                    public_key: string;
                    rp_id: string;
                    origin: string;
                };
                tenant_id: string;
                agent_id: string;
                wallet_id: string;
                label: string;
                credential: string;
                network: "mainnet";
                issued_at_ms: number;
                expires_at_ms: number;
                owner_epoch: number;
                nonce: string;
                recipient: string;
            };
        }, {
            grant_id: string;
            agent_id: string;
            wallet_id: string;
            label: string;
            issued_at: string;
            expires_at: string;
            revoked_at: string | null;
            revoked_reason: string | null;
            owner_epoch: number;
            owner_message: {
                domain: "near-intents-agent-api.agent-grant.v6";
                owner: {
                    type: "near";
                    account_id: string;
                    public_key: string;
                } | {
                    type: "evm";
                    address: string;
                    chain_id: number;
                    public_key: string;
                } | {
                    type: "passkey";
                    credential_id: string;
                    public_key: string;
                    rp_id: string;
                    origin: string;
                };
                tenant_id: string;
                agent_id: string;
                wallet_id: string;
                label: string;
                credential: string;
                network: "mainnet";
                issued_at_ms: number;
                expires_at_ms: number;
                owner_epoch: number;
                nonce: string;
                recipient: string;
            };
        }>>;
    }, z.core.$strip>, {
        UNAUTHORIZED: {
            message: string;
        };
        BAD_REQUEST: {
            message: string;
        };
        CONFLICT: {
            message: string;
        };
        TOO_MANY_REQUESTS: {
            message: string;
        };
        NOT_FOUND: {
            message: string;
        };
        SERVICE_UNAVAILABLE: {
            message: string;
        };
        BAD_GATEWAY: {
            message: string;
        };
        INTERNAL_SERVER_ERROR: {
            message: string;
        };
    }>;
};
export type ContractType = typeof contract;

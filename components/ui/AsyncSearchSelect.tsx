"use client";

import React, { forwardRef, useId } from "react";
import AsyncSelect from "react-select/async";
import type { SelectInstance, StylesConfig } from "react-select";
import { accurateFetch } from "@/lib/apiFetcher";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type AccurateRecord = Record<string, unknown>;

interface SelectOption {
    label: string;
    value: string;
    originalData?: AccurateRecord;
}

interface AsyncSearchSelectProps {
    id?: string;
    label?: string;
    error?: string;
    helperText?: string;
    endpoint: string;
    searchField?: string;
    labelField?: string | ((item: AccurateRecord) => string);
    valueField?: string;
    extraFields?: string;
    required?: boolean;
    placeholder?: string;
    value?: SelectOption | null;
    onChange?: (option: SelectOption | null) => void;
    onBlur?: () => void;
    className?: string;
}

export const AsyncSearchSelect = forwardRef<SelectInstance<SelectOption, false>, AsyncSearchSelectProps>(
    ({ 
        id, label, error, helperText, endpoint, searchField = "name",
        labelField = "name", valueField = "no", extraFields = "",
        required, placeholder = "Ketik untuk mencari...",
        value, onChange, onBlur, className
    }, ref) => {
        const generatedId = useId();
        const selectId = id || generatedId;
        const errorId = error ? `${selectId}-error` : undefined;
        const helperId = helperText && !error ? `${selectId}-helper` : undefined;
        const describedBy = [errorId, helperId].filter(Boolean).join(" ") || undefined;

        const loadOptions = async (inputValue: string): Promise<SelectOption[]> => {
            if (!inputValue) return [];
            try {
                const fields = [valueField];
                if (typeof labelField === 'string') fields.push(labelField);
                if (searchField !== valueField && searchField !== labelField) fields.push(searchField);
                if (extraFields) fields.push(...extraFields.split(','));

                const payload: Record<string, string> = {
                    fields: Array.from(new Set(fields)).join(',')
                };

                if (inputValue) {
                    payload.keywords = inputValue;
                }

                const response = await accurateFetch(endpoint, "GET", payload) as { d?: AccurateRecord[] };
                if (response && response.d) {
                    let results = response.d;
                    
                    // Local Strict Filtering: Accurate's global 'keywords' search is too aggressive 
                    // (finds matches in hidden addresses, contacts, etc). We force a strict UI filter here.
                    if (inputValue) {
                        const searchLower = inputValue.toLowerCase();
                        results = results.filter((item) => {
                            const resolvedLabel = typeof labelField === 'function' ? labelField(item) : item[labelField];
                            return (
                                String(resolvedLabel || "").toLowerCase().includes(searchLower) ||
                                String(item[valueField] || "").toLowerCase().includes(searchLower) ||
                                String(item.name || "").toLowerCase().includes(searchLower) ||
                                String(item.no || "").toLowerCase().includes(searchLower)
                            );
                        });
                    }

                    return results.map((item) => ({
                        label: String(typeof labelField === 'function' ? labelField(item) : item[labelField] || ""),
                        value: String(item[valueField] || ""),
                        originalData: item
                    }));
                }
                return [];
            } catch (err) {
                console.error(`Failed to fetch from ${endpoint}:`, err);
                return [];
            }
        };

        const customStyles: StylesConfig<SelectOption, false> = {
            control: (provided, state) => ({
                ...provided,
                backgroundColor: 'var(--surface-2)',
                borderColor: error ? 'rgba(239, 68, 68, 0.5)' : state.isFocused ? 'rgba(67, 94, 190, 0.45)' : 'var(--control-border, var(--border-soft))',
                color: 'var(--luxury-text)',
                boxShadow: state.isFocused ? (error ? '0 0 0 2px rgba(239, 68, 68, 0.18)' : '0 0 0 3px rgba(67, 94, 190, 0.10)') : 'none',
                '&:hover': {
                    borderColor: error ? 'rgba(239, 68, 68, 0.5)' : 'var(--border-strong)',
                },
                minHeight: '40px',
                borderRadius: '0.375rem',
            }),
            menu: (provided) => ({
                ...provided,
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border-soft)',
                boxShadow: 'var(--luxury-shadow)',
                zIndex: 50,
            }),
            option: (provided, state) => ({
                ...provided,
                backgroundColor: state.isSelected ? 'rgba(67, 94, 190, 0.14)' : state.isFocused ? 'var(--surface-2)' : 'transparent',
                color: state.isSelected ? 'var(--luxury-soft)' : 'var(--luxury-text)',
                cursor: 'pointer',
                '&:active': {
                    backgroundColor: 'rgba(67, 94, 190, 0.18)',
                },
            }),
            singleValue: (provided) => ({
                ...provided,
                color: 'var(--luxury-text)',
            }),
            input: (provided) => ({
                ...provided,
                color: 'var(--luxury-text)',
            }),
            placeholder: (provided) => ({
                ...provided,
                color: 'var(--luxury-subtle)',
                fontSize: '0.875rem',
            }),
            indicatorSeparator: () => ({
                display: 'none',
            }),
        };

        return (
            <div className={cn("flex flex-col gap-1.5 w-full", className)}>
                {label && (
                    <label htmlFor={selectId} className="text-sm font-medium text-slate-300">
                        {label} {required && <span className="text-red-400">*</span>}
                    </label>
                )}
                
                <AsyncSelect<SelectOption, false>
                    ref={ref}
                    inputId={selectId}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy}
                    cacheOptions
                    defaultOptions
                    loadOptions={loadOptions}
                    value={value}
                    onChange={(newValue) => onChange?.(newValue)}
                    onBlur={onBlur}
                    placeholder={placeholder}
                    styles={customStyles}
                    noOptionsMessage={() => "Tidak ada data ditemukan"}
                    loadingMessage={() => "Mencari data..."}
                />

                {error && (
                    <span id={errorId} className="text-xs text-red-400 font-medium animate-in fade-in slide-in-from-top-1">
                        {error}
                    </span>
                )}
                {helperText && !error && (
                    <span id={helperId} className="text-xs text-slate-500">
                        {helperText}
                    </span>
                )}
            </div>
        );
    }
);

AsyncSearchSelect.displayName = "AsyncSearchSelect";

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Camera, Trash2, LoaderCircle } from 'lucide-react';
import { useModalFocus } from '@/src/hooks/useModalFocus';

const BIO_MAX_LENGTH = 200;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export interface ProfileModalValues {
  name: string;
  bio: string;
  avatarUrl: string | null;
}

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The values shown when the modal opens (saved overrides already merged with the session). */
  profile: ProfileModalValues & { email: string };
  onSave: (next: ProfileModalValues) => void;
}

const initialsFor = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';

const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose, profile, onSave }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatarUrl);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Start each open from the current profile.
  useEffect(() => {
    if (!isOpen) return;
    setName(profile.name);
    setBio(profile.bio);
    setAvatarUrl(profile.avatarUrl);
    setError(null);
    setUploading(false);
  }, [isOpen, profile.name, profile.bio, profile.avatarUrl]);

  useModalFocus(isOpen, onClose, dialogRef, nameInputRef);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Pick an image file (PNG, JPG, or similar).');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError('That image is over 2MB. Pick a smaller one.');
      return;
    }
    setUploading(true);
    setError(null);
    // Mock upload: read the file into a data URL kept in the local profile store.
    const reader = new FileReader();
    reader.onload = () => {
      setAvatarUrl(typeof reader.result === 'string' ? reader.result : null);
      setUploading(false);
    };
    reader.onerror = () => {
      setError('Could not read that image. Try another file.');
      setUploading(false);
    };
    reader.readAsDataURL(file);
  }, []);

  if (!isOpen) return null;

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0 && !uploading;

  const handleSave = () => {
    if (!canSave) return;
    onSave({ name: trimmedName, bio: bio.trim(), avatarUrl });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
        className="relative w-full max-w-[420px] overflow-hidden rounded-2xl border border-white/[0.09] bg-[#202020] shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3.5 top-3.5 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-[#8f8b86] transition-colors hover:bg-white/[0.06] hover:text-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleSave();
          }}
        >
          <div className="px-6 pb-6 pt-7">
            <h2 id="profile-modal-title" className="text-[17px] font-semibold tracking-[-0.01em] text-[#f3f1ee]">
              Profile
            </h2>
            <p className="mt-0.5 text-[12.5px] text-[#8f8b86]">
              How you appear in ChatterStack. Saved on this device for now.
            </p>

            {/* Avatar */}
            <div className="mt-5 flex items-center gap-4">
              <div className="relative h-[68px] w-[68px] shrink-0">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- data: URLs from the mock upload can't go through next/image
                  <img
                    src={avatarUrl}
                    alt={`${trimmedName || 'Your'} avatar`}
                    className="h-full w-full rounded-full object-cover ring-1 ring-white/10"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-[#3a3a3a] text-[20px] font-medium text-[#e2dfda] ring-1 ring-white/10">
                    {initialsFor(trimmedName || profile.name)}
                  </div>
                )}
                {uploading && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55">
                    <LoaderCircle className="h-5 w-5 animate-spin text-white" />
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[12.5px] font-medium text-[#e6e3de] transition-colors hover:bg-white/[0.09]"
                >
                  <Camera className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {avatarUrl ? 'Change photo' : 'Add photo'}
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarUrl(null)}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-[#8f8b86] transition-colors hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                    Remove
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                  aria-label="Choose a profile picture"
                />
              </div>
            </div>

            {/* Name */}
            <label className="mt-5 block">
              <span className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.04em] text-[#8f8b86]">
                Name
              </span>
              <input
                ref={nameInputRef}
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                placeholder="Your name"
                className="w-full rounded-xl border border-white/[0.09] bg-[#171717] px-3.5 py-2.5 text-[13.5px] text-[#f0eeeb] placeholder:text-[#6f6b66] focus:border-white/25 focus:outline-none"
              />
            </label>

            {/* Email (read-only: tied to the sign-in provider) */}
            {profile.email && (
              <div className="mt-4">
                <span className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.04em] text-[#8f8b86]">
                  Email
                </span>
                <p className="truncate rounded-xl border border-white/[0.05] bg-white/[0.03] px-3.5 py-2.5 text-[13.5px] text-[#a7a39e]">
                  {profile.email}
                </p>
              </div>
            )}

            {/* Bio */}
            <label className="mt-4 block">
              <span className="mb-1.5 flex items-baseline justify-between text-[12px] font-medium uppercase tracking-[0.04em] text-[#8f8b86]">
                <span>Bio</span>
                <span className="normal-case tracking-normal text-[#6f6b66] tabular-nums">
                  {bio.length}/{BIO_MAX_LENGTH}
                </span>
              </span>
              <textarea
                value={bio}
                onChange={(event) => setBio(event.target.value.slice(0, BIO_MAX_LENGTH))}
                maxLength={BIO_MAX_LENGTH}
                rows={3}
                placeholder="A line or two about you"
                className="w-full resize-none rounded-xl border border-white/[0.09] bg-[#171717] px-3.5 py-2.5 text-[13.5px] leading-5 text-[#f0eeeb] placeholder:text-[#6f6b66] focus:border-white/25 focus:outline-none"
              />
            </label>

            {error && (
              <p role="alert" className="mt-3 text-[12.5px] text-red-400">
                {error}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] bg-white/[0.02] px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-[13px] font-medium text-[#a7a39e] transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="rounded-xl bg-[#f0eeeb] px-4 py-2 text-[13px] font-semibold text-[#191919] transition-opacity hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProfileModal;

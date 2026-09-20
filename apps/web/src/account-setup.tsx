import { useState } from "react";
import { Modal, type Field } from "./components";
export const accountDeliveryField: Field = {
  name: "delivery",
  label: "Password setup",
  type: "select",
  defaultValue: "LINK",
  options: [
    { value: "LINK", label: "Copy a one-time setup link (no email required)" },
    {
      value: "EMAIL",
      label: "Send setup email (requires email configuration)",
    },
  ],
};
export const ownerPasswordField: Field = {
  name:'password',label:'Set owner password (optional)',type:'password',required:false,
  hint:'Use 12–128 characters. If entered, this password is used instead of the setup link or email. Leave blank to let the owner choose a password.',
  validate:value=>value && (value.length<12||value.length>128)?'Use a password with 12–128 characters.':undefined,
};
export type AccountSetup = {
  status: string;
  email: string;
  login_path: string;
  setup_url?: string;
  expires_in_hours?: number;
  message: string;
};
export function AccountSetupResult({
  result,
  onClose,
}: {
  result: AccountSetup;
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  return (
    <Modal title="Account created" onClose={onClose}>
      <div className="notice" role="status">
        {result.message}
      </div>
      <dl>
        <div>
          <dt>Login email</dt>
          <dd>{result.email}</dd>
        </div>
        <div>
          <dt>Login page</dt>
          <dd>{result.login_path}</dd>
        </div>
      </dl>
      {result.setup_url && (
        <div className="form">
          <label>
            One-time password setup link
            <input
              readOnly
              value={result.setup_url}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <small>
            Valid for {result.expires_in_hours} hours and usable once. Share
            privately with the account holder. They must be signed out before
            opening it. This link is shown only here.
          </small>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(result.setup_url!);
                setMessage("Setup link copied.");
              } catch {
                setMessage("Select the link above and copy it manually.");
              }
            }}
          >
            Copy setup link
          </button>
          {message && <p role="status">{message}</p>}
        </div>
      )}
      <button className="primary" style={{ marginTop: 20 }} onClick={onClose}>
        Done
      </button>
    </Modal>
  );
}

/** A list of people an email goes to, found by the slug the code asks for. */
export interface RecipientList {
  slug: string;
  name: string;
  description: string | null;
  /** The portal itself sends to it: it can be switched off or filled, not deleted. */
  system: boolean;
  active: boolean;
  /** People switched on, the ones a mail would reach. */
  recipients: number;
}

export interface Recipient {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
}

export interface RecipientListView extends RecipientList {
  people: Recipient[];
}

export interface NewRecipientList {
  slug: string;
  name: string;
  description?: string;
}

<script lang="ts">
  import Sidebar from './lib/Sidebar.svelte';
  import TopBar from './lib/TopBar.svelte';
  import Toast from './lib/Toast.svelte';
  import EditProfileModal from './lib/EditProfileModal.svelte';
  import Login from './lib/Login.svelte';
  import Signup from './lib/Signup.svelte';
  import Overview from './lib/Overview.svelte';
  import Users from './lib/Users.svelte';
  import UserDetail from './lib/UserDetail.svelte';
  import NewUser from './lib/NewUser.svelte';
  import Assistant from './lib/Assistant.svelte';
  import Bids from './lib/Bids.svelte';
  import BidDetail from './lib/BidDetail.svelte';
  import NewBid from './lib/NewBid.svelte';
  import Profile from './lib/Profile.svelte';
  import Billing from './lib/Billing.svelte';
  import { USERS, TOTAL_USERS, initials } from './data';
  import { BIDS, BID_STAGES } from './bids';
  import { CURRENT_PLAN, planById } from './subscription';
  import {
    restoreSession, logout as apiLogout, getAccessToken, ApiError,
    fetchUsers, fetchUserFacets, createUser, updateUser, changeUserRole,
    resetUserPassword, archiveUser, bulkUsers,
    fetchBids, changeBidStage, createBid,
    type SessionUser, type BulkAction, type UserFacets
  } from './api';
  import { toUser, toBid, userQueryFrom, bidQueryFrom } from './adapters';
  import { onMount } from 'svelte';
  import type {
    Bid, BidStageFilter, Density, NewBidDraft, NewUserDraft, PlanId,
    RoleFilter, Screen, SignupDraft, User, UserPatch
  } from './types';

  export let startScreen: Screen = 'login';
  export let density: Density = 'Dense';
  export let maskEmails = false;

  let screen: Screen = startScreen;
  // Null while signed out or running on local demo data.
  let session: SessionUser | null = null;

  /**
   * A refresh cookie may still be valid from a previous visit — restore the session
   * before painting the login screen, so a reload doesn't sign the user out.
   */
  onMount(async () => {
    // Stripe sends the user back with ?checkout=success|cancelled.
    const checkout = new URLSearchParams(window.location.search).get('checkout');
    if (checkout) {
      history.replaceState(null, '', window.location.pathname);
      notify(checkout === 'success' ? 'Payment confirmed — your subscription is active' : 'Checkout cancelled — nothing was charged');
    }

    if (startScreen !== 'login') return;
    const restored = await restoreSession();
    if (restored) {
      session = restored.user;
      meName = restored.user.name;
      screen = 'overview';
      notify('Welcome back, ' + restored.user.name.split(' ')[0]);
      await loadAll();
    }
  });

  const signedIn = async (user: SessionUser): Promise<void> => {
    session = user;
    meName = user.name;
    screen = 'overview';
    notify('Signed in as ' + user.email);
    await loadAll();
  };

  const signOut = async (): Promise<void> => {
    await apiLogout();
    session = null;
    // Back to fixtures so the signed-out screens still render something real.
    users = USERS;
    bids = BIDS;
    facets = null;
    selectedIds = [];
    screen = 'login';
    notify('Signed out');
  };
  let users: User[] = USERS;
  let bids: Bid[] = BIDS;

  /**
   * The screens run on fixtures until a session exists, then on server data. Keeping both
   * paths live means the design review flow still works with the API switched off, and it
   * is the only reason `data.ts` is still imported.
   */
  const live = (): boolean => !!getAccessToken();
  let loading = false;
  let facets: UserFacets | null = null;
  let userTotal = TOTAL_USERS;
  let selectedIds: string[] = [];

  const fail = (err: unknown, fallback: string): void =>
    notify(err instanceof ApiError ? err.message : fallback);

  /** Server-side filtering — the query state is sent up rather than applied locally. */
  const loadUsers = async (): Promise<void> => {
    if (!live()) return;
    loading = true;
    try {
      const page = await fetchUsers({ ...userQueryFrom({ query, role, team: 'All', status: 'All', mfa: 'All', sort: 'Name' }), limit: 100 });
      users = page.items.map(toUser);
      userTotal = page.total;
    } catch (err) {
      fail(err, 'Could not load users');
    } finally {
      loading = false;
    }
  };

  /** Advanced-filter state lives here so it can be sent to the server, not applied locally. */
  let bidFilters = { owner: 'All', sector: 'All', due: 'All', sort: 'Due date' };
  let bidPaging: { page: number; limit: number; total: number; pages: number } | null = null;
  let bidPage = 1;
  let bidOwners: string[] = [];
  let bidSectors: string[] = [];

  const loadBids = async (): Promise<void> => {
    if (!live()) return;
    loading = true;
    try {
      const page = await fetchBids({
        ...bidQueryFrom({ query: bidQuery, stage: bidStage, ...bidFilters }),
        page: bidPage,
        limit: 25
      });
      bids = page.items.map(toBid);
      bidPaging = { page: page.page, limit: page.limit, total: page.total, pages: page.pages };

      // A page of rows can't tell you every owner or sector — take them from the unpaged set once.
      if (!bidOwners.length) {
        const all = await fetchBids({ limit: 100 }).catch(() => null);
        if (all) {
          bidOwners = [...new Set(all.items.map((x) => x.ownerName ?? '—'))].filter((x) => x !== '—').sort();
          bidSectors = [...new Set(all.items.map((x) => x.sector ?? '—'))].filter((x) => x !== '—').sort();
        }
      }
    } catch (err) {
      fail(err, 'Could not load bids');
    } finally {
      loading = false;
    }
  };

  /** Any filter change resets to page 1 — staying on page 4 of a new result set is never right. */
  const applyBidFilters = (next: typeof bidFilters): void => {
    const changed = JSON.stringify(next) !== JSON.stringify(bidFilters);
    bidFilters = next;
    if (changed && live()) {
      bidPage = 1;
      void loadBids();
    }
  };

  const goBidPage = (n: number): void => {
    bidPage = n;
    void loadBids();
  };

  const loadFacets = async (): Promise<void> => {
    if (!live()) return;
    facets = await fetchUserFacets().catch(() => null);
  };

  const loadAll = async (): Promise<void> => {
    await Promise.all([loadUsers(), loadBids(), loadFacets()]);
  };

  // Refetch when the filters change, but only on live data — fixtures filter locally.
  let lastUserKey = '';
  $: if (live() && (screen === 'users' || screen === 'overview')) {
    const key = query + '|' + role;
    if (key !== lastUserKey) {
      lastUserKey = key;
      void loadUsers();
    }
  }

  let lastBidKey = '';
  $: if (live() && screen === 'bids') {
    const key = bidQuery + '|' + bidStage;
    if (key !== lastBidKey) {
      lastBidKey = key;
      bidPage = 1;
      void loadBids();
    }
  }
  let query = '';
  let role: RoleFilter = 'All';
  let bidStage: BidStageFilter = 'All';
  let bidQuery = '';
  let selectedId = 'u_10712';
  let selectedBidId = 'BID-2418';
  let editing = false;
  let toast: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let collapsed = false;
  let userFormMode: 'create' | 'invite' = 'create';
  let plan: PlanId = CURRENT_PLAN;
  let meName = 'Avery Mercer';

  const notify = (message: string): void => {
    clearTimeout(timer);
    toast = message;
    timer = setTimeout(() => (toast = null), 2600);
  };

  const patchSelected = (patch: UserPatch): void => {
    users = users.map((u) => (u.id === selected.id ? { ...u, ...patch } : u));
  };

  /** Optimistic: the row updates immediately, and reverts if the server refuses. */
  const saveProfile = async (patch: UserPatch): Promise<void> => {
    const before = users;
    patchSelected(patch);
    editing = false;

    if (!live()) {
      notify('Profile saved');
      return;
    }
    try {
      const saved = await updateUser(selected.id, { name: patch.name, email: patch.email, team: patch.team });
      users = users.map((u) => (u.id === saved._id ? toUser(saved) : u));
      notify('Profile saved');
    } catch (err) {
      users = before;
      fail(err, 'Could not save profile');
    }
  };

  const setRole = async (next: User['role']): Promise<void> => {
    const before = users;
    patchSelected({ role: next });

    if (!live()) {
      notify('Role updated — ' + selected.name + ' is now ' + next);
      return;
    }
    try {
      const { user, message } = await changeUserRole(selected.id, next);
      users = users.map((u) => (u.id === user._id ? toUser(user) : u));
      notify(message ?? 'Role updated');
    } catch (err) {
      users = before;
      fail(err, 'Could not change role');
    }
  };

  const sendReset = async (): Promise<void> => {
    if (!live()) {
      notify('Password reset link sent to ' + selected.email);
      return;
    }
    try {
      notify((await resetUserPassword(selected.id)) ?? 'Password reset link sent');
    } catch (err) {
      fail(err, 'Could not send the reset link');
    }
  };

  const archiveSelected = async (): Promise<void> => {
    if (!live()) {
      users = users.filter((u) => u.id !== selected.id);
      screen = 'users';
      notify(selected.name + ' archived');
      return;
    }
    try {
      const message = await archiveUser(selected.id);
      screen = 'users';
      await loadUsers();
      notify(message ?? 'User archived');
    } catch (err) {
      fail(err, 'Could not archive this user');
    }
  };

  /** Bulk actions report partial success — the server may decline individual rows. */
  const runBulk = async (action: BulkAction, extra: { role?: User['role']; status?: User['status'] } = {}): Promise<void> => {
    if (!selectedIds.length) return;
    if (!live()) {
      notify(selectedIds.length + ' selected — bulk actions need a live session');
      return;
    }
    try {
      const result = await bulkUsers(selectedIds, action, extra);
      selectedIds = [];
      await loadUsers();
      notify(
        result.skipped.length
          ? (result.message ?? '') + ' · ' + result.skipped[0].reason
          : result.message ?? 'Updated'
      );
    } catch (err) {
      fail(err, 'Bulk action failed');
    }
  };

  const addUser = (draft: NewUserDraft): void => {
    const user: User = {
      id: 'u_' + (11400 + users.length),
      name: draft.name.trim(),
      email: draft.email.trim().toLowerCase(),
      role: draft.role,
      team: draft.team,
      status: 'Invited',
      seen: '—',
      mfa: draft.requireMfa ? 'Pending' : 'Not enrolled',
      pwAge: '—',
      sessions: '0 devices',
      joined: 'Aug 2026',
      location: draft.location.trim() || '—'
    };
    if (!live()) {
      users = [...users, user];
      screen = 'users';
      notify('Invite sent to ' + user.email + ' · role ' + user.role);
      return;
    }

    void (async () => {
      try {
        const created = await createUser({
          name: draft.name.trim(),
          email: draft.email.trim().toLowerCase(),
          role: draft.role,
          team: draft.team,
          manager: draft.manager?.trim() || undefined,
          location: draft.location?.trim() || undefined,
          requireMfa: true,
          sendInvite: userFormMode === 'invite'
        });
        screen = 'users';
        await Promise.all([loadUsers(), loadFacets()]);
        notify(created.message ?? 'User created');
      } catch (err) {
        fail(err, 'Could not create this user');
      }
    })();
  };

  const addBid = (draft: NewBidDraft): void => {
    const id = 'BID-' + (2419 + bids.length);
    const bid: Bid = {
      id,
      title: draft.title.trim(),
      client: draft.client.trim(),
      sector: draft.sector,
      value: Math.max(0, Math.round(Number(draft.value) || 0)),
      stage: draft.stage,
      owner: draft.owner,
      due: draft.due.trim() || 'TBC',
      daysLeft: Math.max(0, Math.round(Number(draft.daysLeft) || 30)),
      probability: Math.min(100, Math.max(0, Math.round(Number(draft.probability) || 25))),
      submittedOn: '—',
      incumbent: draft.incumbent.trim() || 'Unknown',
      tasks: [
        { label: 'Bid/no-bid scoring', owner: draft.owner, done: false },
        { label: 'Draft technical response', owner: draft.owner, done: false },
        { label: 'Pricing sign-off', owner: 'Avery Mercer', done: false }
      ],
      notes: [
        { time: 'just now', text: 'Bid created by ' + meName + ' from ' + (draft.receivedOn.trim() || 'an inbound enquiry') + '.' }
      ]
    };
    if (live()) {
      void (async () => {
        try {
          const created = await createBid({
            reference: draft.ref.trim(),
            title: draft.title.trim(),
            client: draft.client.trim(),
            sector: draft.sector,
            contactName: draft.contactName?.trim() || undefined,
            contact: draft.contact?.trim() || undefined,
            value: Number(String(draft.value).replace(/[^\d]/g, '')) || 0,
            stage: draft.stage,
            ownerName: draft.owner,
            probability: Number(draft.probability) || 25
          });
          selectedBidId = created.bid._id;
          screen = 'bid';
          await loadBids();
          notify(created.message ?? 'Bid created');
        } catch (err) {
          fail(err, 'Could not create this bid');
        }
      })();
      return;
    }

    bids = [bid, ...bids];
    selectedBidId = id;
    screen = 'bid';
    notify(id + ' created — ' + bid.title);
  };

  const finishSignup = (draft: SignupDraft, user: SessionUser | null): void => {
    plan = draft.plan;
    session = user;
    meName = user?.name ?? draft.name.trim() ?? meName;
    screen = 'overview';
    notify('Workspace created — 14-day ' + planById(draft.plan).name + ' trial started');
  };

  $: selected = users.find((u) => u.id === selectedId) ?? users[0];
  $: selectedBid = bids.find((b) => b.id === selectedBidId) ?? bids[0];
  $: openBidCount = bids.filter((b) => b.stage !== 'Won' && b.stage !== 'Lost').length;

  const advanceBid = (): void => {
    const order = BID_STAGES.filter((s) => s !== 'Lost');
    const next = order[Math.min(order.indexOf(selectedBid.stage) + 1, order.length - 1)];
    if (next === selectedBid.stage) {
      notify(selectedBid.id + ' is already at the final stage');
      return;
    }
    const before = bids;
    bids = bids.map((b) => (b.id === selectedBid.id ? { ...b, stage: next } : b));

    if (!live()) {
      notify(selectedBid.ref + ' moved to ' + next);
      return;
    }

    void (async () => {
      try {
        const { bid, message } = await changeBidStage(selectedBid.id, next);
        bids = bids.map((b) => (b.id === bid._id ? toBid(bid) : b));
        notify(message ?? 'Stage updated');
      } catch (err) {
        bids = before;
        fail(err, 'Could not change the stage');
      }
    })();
  };

  $: filtered = live() ? users : (() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      const okRole = role === 'All' || u.role === role;
      const okQuery = !q || (u.name + ' ' + u.email + ' ' + u.team).toLowerCase().includes(q);
      return okRole && okQuery;
    });
  })();

  $: crumb =
    screen === 'detail' ? 'users / ' + selected.id :
    screen === 'invite' ? 'users / new' :
    screen === 'newbid' ? 'bids / new' :
    screen === 'bid' ? 'bids / ' + selectedBid.id :
    screen === 'bids' ? 'bids' :
    screen === 'users' ? 'users' :
    screen === 'assistant' ? 'assistant' :
    screen === 'profile' ? 'account / profile' :
    screen === 'billing' ? 'account / subscription' :
    'overview';

  $: onBids = screen === 'bids' || screen === 'bid' || screen === 'newbid';
</script>

{#if screen === 'login'}
  <Login
    on:signin={(e) => void signedIn(e.detail)}
    on:demo={() => { screen = 'overview'; notify('Running on local demo data'); }}
    on:signup={() => (screen = 'signup')}
  />
{:else if screen === 'signup'}
  <Signup
    on:created={(e) => finishSignup(e.detail.draft, e.detail.user)}
    on:signin={() => (screen = 'login')}
    on:notify={(e) => notify(e.detail)}
  />
{:else}
  <div style="display: grid; grid-template-columns: {collapsed ? '56px' : '224px'} 1fr; min-height: 100vh;">
    <Sidebar
      {screen}
      {collapsed}
      {meName}
      meInitials={initials(meName)}
      totalUsers={userTotal}
      openBids={openBidCount}
      planName={planById(plan).name}
      on:navigate={(e) => (screen = e.detail)}
      on:toggle={() => (collapsed = !collapsed)}
      on:logout={signOut}
    />

    <main style="min-width: 0; display: flex; flex-direction: column;">
      <TopBar
        {crumb}
        actionLabel={onBids ? 'New bid' : 'New user'}
        on:invite={() => { if (onBids) { screen = 'newbid'; } else { userFormMode = 'create'; screen = 'invite'; } }}
      />

      <div style="padding: 24px 20px 64px; flex: 1;">
        {#if screen === 'overview'}
          <Overview {users} />
        {:else if screen === 'users'}
          <Users
            users={filtered}
            {query}
            {role}
            {density}
            {maskEmails}
            {facets}
            {loading}
            bind:selectedIds
            on:bulk={(e) => void runBulk(e.detail.action, e.detail.extra ?? {})}
            on:query={(e) => (query = e.detail)}
            on:role={(e) => (role = e.detail)}
            on:open={(e) => { selectedId = e.detail; screen = 'detail'; }}
            on:create={() => { userFormMode = 'create'; screen = 'invite'; }}
            on:invite={() => { userFormMode = 'invite'; screen = 'invite'; }}
          />
        {:else if screen === 'detail'}
          <UserDetail
            user={selected}
            {maskEmails}
            on:back={() => (screen = 'users')}
            on:edit={() => (editing = true)}
            on:resetPassword={() => void sendReset()}
            on:changeRole={(e) => void setRole(e.detail)}
            on:archive={() => void archiveSelected()}
          />
        {:else if screen === 'invite'}
          <NewUser {users} mode={userFormMode} on:create={(e) => addUser(e.detail)} on:cancel={() => (screen = 'users')} />
        {:else if screen === 'bids'}
          <Bids
            {bids}
            stage={bidStage}
            query={bidQuery}
            paging={bidPaging}
            {loading}
            owners={bidOwners}
            sectors={bidSectors}
            on:filters={(e) => applyBidFilters(e.detail)}
            on:page={(e) => goBidPage(e.detail)}
            on:stage={(e) => (bidStage = e.detail)}
            on:query={(e) => (bidQuery = e.detail)}
            on:open={(e) => { selectedBidId = e.detail; screen = 'bid'; }}
            on:create={() => (screen = 'newbid')}
          />
        {:else if screen === 'bid'}
          <BidDetail
            bid={selectedBid}
            on:back={() => (screen = 'bids')}
            on:advance={advanceBid}
            on:assign={() => notify('Owner reassignment sent to ' + selectedBid.owner)}
          />
        {:else if screen === 'newbid'}
          <NewBid {bids} on:create={(e) => addBid(e.detail)} on:cancel={() => (screen = 'bids')} />
        {:else if screen === 'assistant'}
          <Assistant {users} />
        {:else if screen === 'profile'}
          <Profile on:notify={(e) => notify(e.detail)} on:billing={() => (screen = 'billing')} />
        {:else if screen === 'billing'}
          <Billing on:notify={(e) => notify(e.detail)} />
        {/if}
      </div>
    </main>

    {#if editing}
      <EditProfileModal
        user={selected}
        on:close={() => (editing = false)}
        on:save={(e) => void saveProfile(e.detail)}
      />
    {/if}

    <Toast message={toast} />
  </div>
{/if}

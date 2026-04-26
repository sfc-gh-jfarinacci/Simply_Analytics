import React from 'react';
import {
  FiUsers, FiPlus, FiSearch, FiX, FiLoader, FiTrash2,
  FiChevronDown, FiChevronUp,
} from 'react-icons/fi';

export default function MembersSection({
  isOpen, onToggle, members, isAdmin, currentUser, activeWorkspace, toast,
  canAddMembers, addBtnRef, showAddMember, setShowAddMember,
  memberSearch, setMemberSearch, addMemberError, setAddMemberError,
  dropdownDir, setDropdownDir, memberDropdownRef,
  filteredSearchUsers, memberIds, addingMember,
  handleAddMember, handleAddByEmail, handleRemoveMember,
}) {
  return (
    <div className="ws-flat-section">
      <button className="ws-flat-section-toggle" onClick={onToggle}>
        <span className="ws-flat-section-label"><FiUsers size={14} /> Members <span className="ws-flat-count">{members.length}</span></span>
        {isOpen ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
      </button>
      {isOpen && (
        <div className="ws-flat-section-body">
          <div ref={memberDropdownRef}>
            <div className="ws-member-header">
              <span className="ws-member-count">{members.length} member{members.length !== 1 ? 's' : ''}</span>
              {canAddMembers && (
                <button
                  ref={addBtnRef}
                  className="ws-btn-add-member-text"
                  title="Add member"
                  onClick={() => {
                    if (showAddMember) {
                      setShowAddMember(false);
                      setMemberSearch('');
                      setAddMemberError('');
                    } else {
                      if (addBtnRef.current) {
                        const rect = addBtnRef.current.getBoundingClientRect();
                        const spaceBelow = window.innerHeight - rect.bottom;
                        setDropdownDir(spaceBelow < 280 ? 'up' : 'down');
                      }
                      setShowAddMember(true);
                    }
                  }}
                >
                  {showAddMember ? <FiX size={12} /> : <FiPlus size={12} />}
                  <span>{showAddMember ? 'Cancel' : 'Add'}</span>
                </button>
              )}
            </div>

            {showAddMember && (
              <div className="ws-member-add-bar">
                <div className="ws-member-search-bar">
                  <FiSearch className="ws-member-search-icon" />
                  <input
                    type="text"
                    placeholder={isAdmin ? 'Search by name or email...' : 'Enter full email address...'}
                    value={memberSearch}
                    onChange={e => { setMemberSearch(e.target.value); setAddMemberError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter' && !isAdmin) handleAddByEmail(members); }}
                    autoFocus
                  />
                  {!isAdmin && (
                    <button
                      className="ws-btn ws-btn-primary ws-btn-xs"
                      onClick={() => handleAddByEmail(members)}
                      disabled={addingMember || !memberSearch.trim()}
                    >
                      {addingMember ? <FiLoader className="spinner" /> : 'Add'}
                    </button>
                  )}
                </div>
                {addMemberError && <p className="ws-member-add-error">{addMemberError}</p>}
                {isAdmin && memberSearch.trim() && (
                  <div className={`ws-member-dropdown ws-dropdown-${dropdownDir}`}>
                    <ul className="ws-member-dropdown-list">
                      {filteredSearchUsers.length > 0 ? filteredSearchUsers.map(u => {
                        const isMember = memberIds.has(u.id);
                        return (
                          <li
                            key={u.id}
                            className={`ws-member-dropdown-item${isMember ? ' ws-member-already' : ''}`}
                            onClick={() => {
                              if (isMember) {
                                toast.info(`${u.display_name || u.username} is already a member`);
                              } else {
                                handleAddMember(u.id);
                              }
                            }}
                          >
                            <div className="ws-member-avatar ws-member-avatar-sm">
                              {((u.display_name || u.username || 'U')[0]).toUpperCase()}
                            </div>
                            <div className="ws-member-info">
                              <span className="ws-member-name">{u.display_name || u.username}</span>
                              <span className="ws-member-meta">{u.email}</span>
                            </div>
                            <span className={`ws-member-status ${isMember ? 'ws-status-added' : 'ws-status-not-added'}`}>
                              {isMember ? '✓ Added' : '✕ Not Added'}
                            </span>
                          </li>
                        );
                      }) : (
                        <li className="ws-member-dropdown-empty">No users match that search</li>
                      )}
                    </ul>
                    {addingMember && <div className="ws-member-dropdown-loading"><FiLoader className="spinner" /> Adding...</div>}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="ws-member-scroll">
            {members.length > 0 ? (
              <table className="ws-table">
                <thead>
                  <tr><th></th><th>Name</th><th>Email</th><th>Role</th><th></th></tr>
                </thead>
                <tbody>
                  {members.map(m => {
                    const name = m.display_name || m.username;
                    const mId = m.user_id || m.id;
                    const isWsOwner = mId === activeWorkspace?.created_by;
                    const isSelf = mId === currentUser?.id;
                    const canRemove = isAdmin && !isWsOwner && !isSelf;
                    return (
                      <tr key={mId}>
                        <td className="ws-table-avatar-cell">
                          <div className="ws-member-avatar ws-member-avatar-sm">
                            {(name || 'U')[0].toUpperCase()}
                          </div>
                        </td>
                        <td className="ws-table-name">{name}</td>
                        <td className="ws-table-meta">{m.email || '—'}</td>
                        <td><span className="ws-member-role">{m.role}</span></td>
                        <td className="ws-table-actions">
                          {canRemove && (
                            <button className="ws-btn-icon-sm" onClick={() => handleRemoveMember(mId)} title="Remove">
                              <FiTrash2 size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="ws-muted">No members yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

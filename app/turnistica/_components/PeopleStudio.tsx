"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { createEmployee, deleteEmployee, getEmployees, permanentlyDeleteEmployee, removeEmployeePhoto, updateEmployee, uploadEmployeePhoto } from "@/app/turnistica/_lib/api";
import type { Employee, Store } from "@/app/turnistica/_lib/types";
import { EmployeeAvatar } from "@/app/turnistica/_components/EmployeeAvatar";
import { STORE_LABELS } from "@/app/turnistica/_lib/utils";
import styles from "@/app/turnistica/_components/studio.module.css";

type Props = {
  initialEmployees: Employee[];
};

export function PeopleStudio({ initialEmployees }: Props) {
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [fullName, setFullName] = useState("");
  const [draftHomeStore, setDraftHomeStore] = useState<Store>("duomo");
  const [draftPhoto, setDraftPhoto] = useState<File | null>(null);
  const [draftPreview, setDraftPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  async function load() {
    setLoading(true);
    try {
      setEmployees(await getEmployees());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Errore caricamento personale");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    return () => {
      if (draftPreview?.startsWith("blob:")) {
        URL.revokeObjectURL(draftPreview);
      }
    };
  }, [draftPreview]);

  const activeCount = useMemo(() => employees.filter((employee) => employee.active).length, [employees]);
  const archivedCount = useMemo(() => employees.filter((employee) => !employee.active).length, [employees]);
  const duomoCount = useMemo(() => employees.filter((employee) => employee.active && employee.homeStore === "duomo").length, [employees]);
  const buenosCount = useMemo(() => employees.filter((employee) => employee.active && employee.homeStore === "buenos_aires").length, [employees]);
  const storeGroups = useMemo(
    () => [
      { store: "duomo" as const, title: STORE_LABELS.duomo.toUpperCase(), employees: employees.filter((employee) => employee.homeStore === "duomo") },
      {
        store: "buenos_aires" as const,
        title: STORE_LABELS.buenos_aires.toUpperCase(),
        employees: employees.filter((employee) => employee.homeStore === "buenos_aires")
      }
    ],
    [employees]
  );

  function onDraftPhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setDraftPhoto(file);

    if (draftPreview?.startsWith("blob:")) {
      URL.revokeObjectURL(draftPreview);
    }

    setDraftPreview(file ? URL.createObjectURL(file) : null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fullName.trim()) return;

    try {
      const created = await createEmployee({ fullName: fullName.trim(), homeStore: draftHomeStore });
      if (draftPhoto) {
        await uploadEmployeePhoto(created.id, draftPhoto);
      }

      setFullName("");
      setDraftHomeStore("duomo");
      setDraftPhoto(null);
      if (draftPreview?.startsWith("blob:")) {
        URL.revokeObjectURL(draftPreview);
      }
      setDraftPreview(null);
      setMessage("Personale aggiornato");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Errore salvataggio persona");
    }
  }

  async function onToggleActive(employee: Employee) {
    try {
      setBusyId(employee.id);
      if (employee.active) {
        await deleteEmployee(employee.id);
        setMessage("Persona archiviata");
      } else {
        await updateEmployee({ id: employee.id, active: true });
        setMessage("Persona riattivata");
      }
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Errore aggiornamento stato");
    } finally {
      setBusyId(null);
    }
  }

  async function onPermanentDelete(employee: Employee) {
    const confirmed = window.confirm(
      `Eliminare definitivamente ${employee.fullName}?\n\nQuesta azione rimuove persona, foto e dati collegati anche dal database.`
    );

    if (!confirmed) return;

    try {
      setBusyId(employee.id);
      await permanentlyDeleteEmployee(employee.id);
      setMessage("Persona eliminata definitivamente");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Errore eliminazione definitiva");
    } finally {
      setBusyId(null);
    }
  }

  async function onUploadEmployeePhoto(employeeId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setBusyId(employeeId);
      await uploadEmployeePhoto(employeeId, file);
      setMessage("Foto aggiornata");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Errore caricamento foto");
    } finally {
      setBusyId(null);
      event.target.value = "";
    }
  }

  async function onRemovePhoto(employeeId: string) {
    try {
      setBusyId(employeeId);
      await removeEmployeePhoto(employeeId);
      setMessage("Foto rimossa");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Errore rimozione foto");
    } finally {
      setBusyId(null);
    }
  }

  function openEditor(employee: Employee) {
    setEditingId(employee.id);
    setEditingName(employee.fullName);
  }

  async function onSaveName(employeeId: string) {
    if (!editingName.trim()) return;

    try {
      setBusyId(employeeId);
      await updateEmployee({ id: employeeId, fullName: editingName.trim() });
      setEditingId(null);
      setEditingName("");
      setMessage("Nome aggiornato");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Errore aggiornamento nome");
    } finally {
      setBusyId(null);
    }
  }

  async function onChangeHomeStore(employee: Employee, nextStore: Store) {
    if (employee.homeStore === nextStore) return;

    const previousStore = employee.homeStore;
    setBusyId(employee.id);
    setEmployees((current) => current.map((item) => (item.id === employee.id ? { ...item, homeStore: nextStore } : item)));

    try {
      const updated = await updateEmployee({ id: employee.id, homeStore: nextStore });
      setEmployees((current) => current.map((item) => (item.id === employee.id ? updated : item)));
      setMessage(`Negozio aggiornato: ${updated.fullName} ora lavora su ${STORE_LABELS[updated.homeStore]}`);
    } catch (error) {
      setEmployees((current) => current.map((item) => (item.id === employee.id ? { ...item, homeStore: previousStore } : item)));
      setMessage(error instanceof Error ? error.message : "Errore aggiornamento negozio");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <main className={styles.loading}>Caricamento personale...</main>;
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>Atelier Team</span>
        <h2 className={styles.title}>Il personale merita una presenza visiva vera, non solo una lista di nomi.</h2>
        <p className={styles.subtitle}>
          Qui costruisci il team del salone con foto locali, stato attivo e schede ordinate. Tutto resta salvato su questo computer e si ricarica correttamente anche da tablet e telefoni della stessa rete.
        </p>
      </section>

      <section className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Persone attive</span>
          <strong className={styles.summaryValue}>{activeCount}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Duomo</span>
          <strong className={styles.summaryValue}>{duomoCount}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Corso Buenos Aires</span>
          <strong className={styles.summaryValue}>{buenosCount}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Archiviati</span>
          <strong className={styles.summaryValue}>{archivedCount}</strong>
        </article>
      </section>

      {message ? <div className={styles.notice}>{message}</div> : null}

      <section className={styles.panelGrid}>
        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <h3 className={styles.panelTitle}>Nuova persona</h3>
              <p className={styles.panelSubtitle}>Aggiungi il nome e, se vuoi, carica subito la foto che comparirà in home, pianificazione e stampa.</p>
            </div>
            <span className={styles.badge}>Creazione rapida</span>
          </header>

          <form onSubmit={onSubmit} className={styles.peopleComposer}>
            <div className={styles.portraitComposer}>
              <div className={styles.portraitPreview}>
                <EmployeeAvatar fullName={fullName || "Paradise Team"} photoUrl={draftPreview} size="lg" />
              </div>
              <label className={styles.uploadButtonLike}>
                Scegli foto
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onDraftPhotoChange} className={styles.hiddenInput} />
              </label>
              {draftPhoto ? <span className={styles.helper}>File pronto: {draftPhoto.name}</span> : <span className={styles.helper}>Consigliato: foto verticale chiara, massimo 5 MB.</span>}
            </div>

            <div className={styles.peopleFormBody}>
              <label className={styles.fieldSpan}>
                Nome completo
                <input className={styles.input} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Es. Giulia Bianchi" required />
              </label>
              <label className={styles.fieldSpan}>
                Negozio base
                <select className={styles.select} value={draftHomeStore} onChange={(event) => setDraftHomeStore(event.target.value as Store)}>
                  <option value="duomo">{STORE_LABELS.duomo}</option>
                  <option value="buenos_aires">{STORE_LABELS.buenos_aires}</option>
                </select>
              </label>
              <div className={styles.actions}>
                <button type="submit" className={styles.button} disabled={!fullName.trim()}>
                  Aggiungi al team
                </button>
              </div>
            </div>
          </form>
        </article>

        <article className={`${styles.panel} ${styles.panelWide}`}>
          <header className={styles.panelHeader}>
            <div>
              <h3 className={styles.panelTitle}>Team attuale</h3>
              <p className={styles.panelSubtitle}>Ogni scheda mostra identità visiva, stato e comandi per rinominare, archiviare, eliminare o aggiornare il ritratto.</p>
            </div>
            <span className={styles.badge}>{employees.length} elementi</span>
          </header>

          {employees.length === 0 ? (
            <div className={styles.empty}>Nessun dipendente presente. Inserisci il primo nome da questa pagina.</div>
          ) : (
            <div className={styles.storeSectionStack}>
              {storeGroups.map((group) => (
                <section key={group.store} className={styles.storeSection}>
                  <div className={styles.storeSectionHeader}>
                    <div>
                      <h4 className={styles.storeSectionTitle}>{group.title}</h4>
                      <p className={styles.storeSectionMeta}>Da qui puoi controllare chi appartiene al negozio e cambiare il negozio base direttamente dalla scheda.</p>
                    </div>
                    <span className={styles.ruleChip}>{group.employees.length} persone</span>
                  </div>

                  {group.employees.length === 0 ? (
                    <div className={styles.emptyInline}>Nessuna persona assegnata a questo negozio.</div>
                  ) : (
                    <ul className={styles.peopleGrid}>
                      {group.employees.map((employee) => (
                        <li key={employee.id} className={styles.personCardLuxury}>
                          <div className={styles.personCardHeader}>
                            <EmployeeAvatar fullName={employee.fullName} photoUrl={employee.photoUrl} size="lg" />
                            <div className={styles.itemMain}>
                              <span className={styles.itemTitle}>{employee.fullName}</span>
                              <span className={styles.itemMeta}>Disponibile in pianificazione, home operativa e stampa mensile.</span>
                              <div className={styles.personMetaRow}>
                                <span className={styles.badge}>{employee.active ? "Attivo" : "Archiviato"}</span>
                                <span className={styles.ruleChip}>{STORE_LABELS[employee.homeStore]}</span>
                                <span className={styles.metaDot}>{employee.photoUrl ? "Con foto" : "Senza foto"}</span>
                              </div>
                            </div>
                          </div>

                          <label className={styles.compactField}>
                            Negozio base
                            <select
                              className={styles.select}
                              value={employee.homeStore}
                              disabled={busyId === employee.id}
                              onChange={(event) => void onChangeHomeStore(employee, event.target.value as Store)}
                            >
                              <option value="duomo">{STORE_LABELS.duomo}</option>
                              <option value="buenos_aires">{STORE_LABELS.buenos_aires}</option>
                            </select>
                          </label>

                          {editingId === employee.id ? (
                            <div className={styles.editBlock}>
                              <label className={styles.fieldSpan}>
                                Nome completo
                                <input className={styles.input} value={editingName} onChange={(event) => setEditingName(event.target.value)} />
                              </label>
                              <div className={styles.actions}>
                                <button type="button" className={styles.button} disabled={busyId === employee.id || !editingName.trim()} onClick={() => onSaveName(employee.id)}>
                                  Salva nome
                                </button>
                                <button type="button" className={styles.secondaryButton} disabled={busyId === employee.id} onClick={() => setEditingId(null)}>
                                  Annulla
                                </button>
                              </div>
                            </div>
                          ) : null}

                          <div className={styles.cardActionsColumn}>
                            <label className={styles.uploadButtonLike}>
                              {busyId === employee.id ? "Caricamento..." : employee.photoUrl ? "Cambia foto" : "Carica foto"}
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/gif"
                                onChange={(event) => onUploadEmployeePhoto(employee.id, event)}
                                disabled={busyId === employee.id}
                                className={styles.hiddenInput}
                              />
                            </label>
                            <button type="button" className={styles.secondaryButton} disabled={!employee.photoUrl || busyId === employee.id} onClick={() => onRemovePhoto(employee.id)}>
                              Rimuovi foto
                            </button>
                            <button type="button" className={styles.secondaryButton} disabled={busyId === employee.id} onClick={() => openEditor(employee)}>
                              Modifica nome
                            </button>
                            <button type="button" className={styles.dangerButton} disabled={busyId === employee.id} onClick={() => onToggleActive(employee)}>
                              {employee.active ? "Archivia" : "Riattiva"}
                            </button>
                            <button type="button" className={styles.dangerButton} disabled={busyId === employee.id} onClick={() => void onPermanentDelete(employee)}>
                              Elimina
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
        </article>
      </section>
    </main>
  );
}

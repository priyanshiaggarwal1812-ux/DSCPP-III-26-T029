#include "sorted_list.h"
#include <stdlib.h>

typedef struct SNode {
    long long key;
    void *value;
    struct SNode *prev;
    struct SNode *next;
} SNode;

struct SortedList {
    SNode *head;
    SNode *tail;
    size_t size;
};

SortedList* slist_create(void) {
    SortedList *l = (SortedList*)malloc(sizeof(SortedList));
    if (!l) return NULL;
    l->head = NULL;
    l->tail = NULL;
    l->size = 0;
    return l;
}

void slist_destroy(SortedList *l, slist_free_fn free_value) {
    if (!l) return;
    SNode *curr = l->head;
    while (curr) {
        SNode *next = curr->next;
        if (free_value && curr->value) free_value(curr->value);
        free(curr);
        curr = next;
    }
    free(l);
}

size_t slist_size(const SortedList *l) {
    return l ? l->size : 0;
}

int slist_insert(SortedList *l, long long key, void *value) {
    if (!l) return -1;
    // Check if key already exists or find insert position
    SNode *curr = l->head;
    while (curr && curr->key < key) {
        curr = curr->next;
    }

    if (curr && curr->key == key) {
        curr->value = value;
        return 0; // replaced
    }

    SNode *n = (SNode*)malloc(sizeof(SNode));
    if (!n) return -1;
    n->key = key;
    n->value = value;
    n->prev = NULL;
    n->next = NULL;

    if (!curr) {
        // Insert at tail (or empty list)
        if (!l->tail) {
            l->head = n;
            l->tail = n;
        } else {
            n->prev = l->tail;
            l->tail->next = n;
            l->tail = n;
        }
    } else {
        // Insert before curr
        n->next = curr;
        n->prev = curr->prev;
        if (curr->prev) {
            curr->prev->next = n;
        } else {
            l->head = n;
        }
        curr->prev = n;
    }
    l->size++;
    return 1;
}

void* slist_find(const SortedList *l, long long key) {
    if (!l) return NULL;
    SNode *curr = l->head;
    while (curr && curr->key <= key) {
        if (curr->key == key) return curr->value;
        curr = curr->next;
    }
    return NULL;
}

void* slist_erase(SortedList *l, long long key) {
    if (!l) return NULL;
    SNode *curr = l->head;
    while (curr && curr->key <= key) {
        if (curr->key == key) {
            void *val = curr->value;
            if (curr->prev) curr->prev->next = curr->next;
            else l->head = curr->next;

            if (curr->next) curr->next->prev = curr->prev;
            else l->tail = curr->prev;

            free(curr);
            l->size--;
            return val;
        }
        curr = curr->next;
    }
    return NULL;
}

void* slist_min(const SortedList *l, long long *key_out) {
    if (!l || !l->head) return NULL;
    if (key_out) *key_out = l->head->key;
    return l->head->value;
}

void* slist_max(const SortedList *l, long long *key_out) {
    if (!l || !l->tail) return NULL;
    if (key_out) *key_out = l->tail->key;
    return l->tail->value;
}

void* slist_next(const SortedList *l, long long key, long long *key_out) {
    if (!l) return NULL;
    SNode *curr = l->head;
    while (curr && curr->key <= key) {
        curr = curr->next;
    }
    if (!curr) return NULL;
    if (key_out) *key_out = curr->key;
    return curr->value;
}

void* slist_prev(const SortedList *l, long long key, long long *key_out) {
    if (!l) return NULL;
    SNode *curr = l->tail;
    while (curr && curr->key >= key) {
        curr = curr->prev;
    }
    if (!curr) return NULL;
    if (key_out) *key_out = curr->key;
    return curr->value;
}

int slist_check(const SortedList *l) {
    if (!l) return -1;
    if (!l->head) {
        return (l->tail == NULL && l->size == 0) ? 1 : -1;
    }
    size_t count = 0;
    SNode *curr = l->head;
    if (curr->prev != NULL) return -1;

    while (curr) {
        count++;
        if (curr->next) {
            if (curr->next->prev != curr) return -1;
            if (curr->next->key <= curr->key) return -1; // must be strictly sorted
        } else {
            if (l->tail != curr) return -1;
        }
        curr = curr->next;
    }
    return (count == l->size) ? 1 : -1;
}

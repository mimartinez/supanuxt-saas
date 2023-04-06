import { ACCOUNT_ACCESS } from '@prisma/client';
import prisma_client from '~~/prisma/prisma.client';
import { accountWithMembers, AccountWithMembers, membershipWithAccount, MembershipWithAccount, membershipWithUser, MembershipWithUser } from './service.types';

export default class AccountService {
  async getAccountById(account_id: number): Promise<AccountWithMembers> {
    return prisma_client.account.findFirstOrThrow({ 
      where: { id: account_id },
      ...accountWithMembers
    });
  }

  async getAccountMembers(account_id: number): Promise<MembershipWithUser[]> {
    return prisma_client.membership.findMany({ 
      where: { account_id },
      ...membershipWithUser
    });
  }  

  async updateAccountStipeCustomerId (account_id: number, stripe_customer_id: string){
    return await prisma_client.account.update({
      where: { id: account_id },
      data: {
        stripe_customer_id,
      }
    })
  }

  async updateStripeSubscriptionDetailsForAccount (stripe_customer_id: string, stripe_subscription_id: string, current_period_ends: Date, stripe_product_id: string){
    const account = await prisma_client.account.findFirstOrThrow({
      where: {stripe_customer_id}
    });

    const paid_plan = await prisma_client.plan.findFirstOrThrow({ 
      where: { stripe_product_id }, 
    });

    if(paid_plan.id == account.plan_id){
      // only update sub and period info
      return await prisma_client.account.update({
        where: { id: account.id },
        data: {
          stripe_subscription_id,
          current_period_ends,
        }
      });
    } else {
      // plan upgrade/downgrade... update everything, copying over plan features and perks
      return await prisma_client.account.update({
        where: { id: account.id },
        data: {
          stripe_subscription_id,
          current_period_ends,
          plan_id: paid_plan.id,
          features: paid_plan.features,
          max_notes: paid_plan.max_notes,
          max_members: paid_plan.max_members,
          plan_name: paid_plan.name,
        }
      });
    }

  }

  async joinUserToAccount(user_id: number, account_id: number): Promise<MembershipWithAccount> {
    const account = await prisma_client.account.findUnique({
        where: {
          id: account_id,
        },
        include:{
          members: true,
        }
      }
    )

    if(account?.members && account?.members?.length >= account?.max_members){
      throw new Error(`Too Many Members, Account only permits ${account?.max_members} members.`);
    }

    return prisma_client.membership.create({
      data: {
        user_id: user_id,
        account_id,
        access: ACCOUNT_ACCESS.READ_ONLY
      },
      ...membershipWithAccount
    });
  }

  async changeAccountName(account_id: number, new_name: string) {
    return prisma_client.account.update({
      where: { id: account_id},
      data: {
        name: new_name,
      }
    });
  }

  async changeAccountPlan(account_id: number, plan_id: number) {
    const plan = await prisma_client.plan.findFirstOrThrow({ where: {id: plan_id}});
    return prisma_client.account.update({
      where: { id: account_id},
      data: {
        plan_id: plan_id,
        features: plan.features,
        max_notes: plan.max_notes,
      }
    });
  }


  // Claim ownership of an account.  
  // User must already be an ADMIN for the Account
  // Existing OWNER memberships are downgraded to ADMIN
  // In future, some sort of Billing/Stripe tie in here e.g. changing email details on the Account, not sure.
  async claimOwnershipOfAccount(user_id: number, account_id: number) {
    const membership = await prisma_client.membership.findUniqueOrThrow({
      where: {
        user_id_account_id: {
          user_id: user_id,
          account_id: account_id,
        }
      },
    });

    if (membership.access === ACCOUNT_ACCESS.OWNER) {
      return; // already owner
    } else if (membership.access !== ACCOUNT_ACCESS.ADMIN) {
      throw new Error('UNAUTHORISED: only Admins can claim ownership');
    }

    const existing_owner_memberships = await prisma_client.membership.findMany({
      where: {
        account_id: account_id,
        access: ACCOUNT_ACCESS.OWNER,
      },
    });

    for(const existing_owner_membership of existing_owner_memberships) {
      await prisma_client.membership.update({
        where: {
          user_id_account_id: {
            user_id: existing_owner_membership.user_id,
            account_id: account_id,
          }
        },
        data: {
          access: ACCOUNT_ACCESS.ADMIN, // Downgrade OWNER to ADMIN
        }
      });
    }

    // finally update the ADMIN member to OWNER
    return prisma_client.membership.update({
      where: {
        user_id_account_id: {
          user_id: user_id,
          account_id: account_id,
        }
      },
      data: {
        access: ACCOUNT_ACCESS.OWNER,
      },
      include: {
        account: true
      }
    });
  }

  // Upgrade access of a membership.  Cannot use this method to upgrade to or downgrade from OWNER access
  async changeUserAccessWithinAccount(user_id: number, account_id: number, access: ACCOUNT_ACCESS) {
    if (access === ACCOUNT_ACCESS.OWNER) {
      throw new Error('UNABLE TO UPDATE MEMBERSHIP: use claimOwnershipOfAccount method to change ownership');
    }

    const membership = await prisma_client.membership.findUniqueOrThrow({
      where: {
        user_id_account_id: {
          user_id: user_id,
          account_id: account_id,
        }
      },
    });

    if (membership.access === ACCOUNT_ACCESS.OWNER) {
      throw new Error('UNABLE TO UPDATE MEMBERSHIP: use claimOwnershipOfAccount method to change ownership');
    }

    return prisma_client.membership.update({
      where: {
        user_id_account_id: {
          user_id: user_id,
          account_id: account_id,
        }
      },
      data: {
        access: access,
      },
      include: {
        account: true
      }
    });
  }
}